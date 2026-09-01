import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const catalogUrl = 'https://www.congreso.es/es/opendata/iniciativas'
const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = path.join(dataDirectory, 'parlamento.sqlite')
const migrationsDirectory = path.join(dataDirectory, 'migrations')
const acceptedDatasets = /\/(ProyectosDeLey|PropuestasDeReforma|ProposicionesDeLey)__.*\.json$/

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null
}

function date(value) {
  const match = text(value)?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

function urls(value) {
  return text(value)?.match(/https:\/\/[^\s]+/g) || []
}

function status(result, currentStage) {
  if (/^Aprobado/i.test(result || '')) return 'approved'
  if (/^Rechazado|^Inadmitido/i.test(result || '')) return 'rejected'
  if (/^Retirado/i.test(result || '')) return 'withdrawn'
  if (/^Decaído/i.test(result || '')) return 'lapsed'
  if (/^Subsumido/i.test(result || '')) return 'merged'
  if (/^Cerrado$/i.test(currentStage || '')) return 'closed'
  return 'pending'
}

function detailUrl(datasetUrl, expediente) {
  const route = datasetUrl.includes('ProyectosDeLey')
    ? 'proyectos-de-ley'
    : datasetUrl.includes('PropuestasDeReforma')
      ? 'propuestas-de-reforma-de-estatutos-de-autonomia'
      : 'proposiciones-de-ley'
  const id = expediente.replace(/\/0000$/, '')
  const params = new URLSearchParams({
    p_p_id: 'iniciativas',
    p_p_lifecycle: '0',
    p_p_state: 'normal',
    p_p_mode: 'view',
    _iniciativas_mode: 'mostrarDetalle',
    _iniciativas_legislatura: 'XV',
    _iniciativas_id: id,
  })
  return `https://www.congreso.es/es/${route}?${params}`
}

async function download() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(catalogUrl, { waitUntil: 'networkidle', timeout: 120_000 })
    const links = await page.locator('a').evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.href).filter((href) => href.endsWith('.json')),
    )
    const datasetUrls = [...new Set(links.filter((link) => acceptedDatasets.test(link)))]
    if (datasetUrls.length !== 3) throw new Error(`Expected 3 initiative datasets; found ${datasetUrls.length}`)

    const records = []
    for (const datasetUrl of datasetUrls) {
      const rows = await page.evaluate(async (url) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      }, datasetUrl)
      records.push(...rows.map((row) => ({ ...row, datasetUrl })))
    }
    return { records, datasetUrls }
  } finally {
    await browser.close()
  }
}

function validate(records) {
  if (records.length < 400) throw new Error(`Expected at least 400 initiatives; found ${records.length}`)
  const ids = new Set()
  for (const record of records) {
    if (text(record.LEGISLATURA) !== 'Leg.15') throw new Error(`Unexpected legislature: ${record.LEGISLATURA}`)
    const id = text(record.NUMEXPEDIENTE)
    if (!id || !text(record.OBJETO)) throw new Error('Initiative is missing its expediente or title')
    if (ids.has(id)) throw new Error(`Duplicate expediente: ${id}`)
    ids.add(id)
  }
}

const { records, datasetUrls } = await download()
validate(records)

const database = new DatabaseSync(databasePath)
for (const migration of fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'))
}

const importedAt = new Date().toISOString()
const upsert = database.prepare(`
  INSERT INTO legislative_initiatives (
    expediente, legislature, type, title, description, author, presented_on,
    qualified_on, status, official_result, current_stage, official_url,
    source_dataset_url, updated_at
  ) VALUES (?, 15, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (expediente) DO UPDATE SET
    type = excluded.type,
    title = excluded.title,
    author = excluded.author,
    presented_on = excluded.presented_on,
    qualified_on = excluded.qualified_on,
    status = excluded.status,
    official_result = excluded.official_result,
    current_stage = excluded.current_stage,
    official_url = excluded.official_url,
    source_dataset_url = excluded.source_dataset_url,
    updated_at = excluded.updated_at
`)
const insertDocument = database.prepare('INSERT OR IGNORE INTO initiative_documents (expediente, kind, url) VALUES (?, ?, ?)')
const clearDocuments = database.prepare('DELETE FROM initiative_documents WHERE expediente = ?')

database.exec('BEGIN IMMEDIATE; CREATE TEMP TABLE imported_initiative_ids (expediente TEXT PRIMARY KEY)')
const markImported = database.prepare('INSERT INTO imported_initiative_ids (expediente) VALUES (?)')
try {
  for (const record of records) {
    const expediente = text(record.NUMEXPEDIENTE)
    const officialResult = text(record.RESULTADOTRAMITACION)
    const currentStage = text(record.SITUACIONACTUAL)
    upsert.run(
      expediente,
      text(record.TIPO),
      text(record.OBJETO),
      text(record.AUTOR),
      date(record.FECHAPRESENTACION),
      date(record.FECHACALIFICACION),
      status(officialResult, currentStage),
      officialResult,
      currentStage,
      detailUrl(record.datasetUrl, expediente),
      record.datasetUrl,
      importedAt,
    )
    clearDocuments.run(expediente)
    for (const url of urls(record.ENLACESBOCG)) insertDocument.run(expediente, 'BOCG', url)
    for (const url of urls(record.ENLACESDS)) insertDocument.run(expediente, 'Diario de Sesiones', url)
    markImported.run(expediente)
  }
  database.exec(`
    DELETE FROM legislative_initiatives
    WHERE expediente NOT IN (SELECT expediente FROM imported_initiative_ids);
  `)
  database.prepare(`
    INSERT INTO import_state (source, source_url, imported_at, row_count)
    VALUES ('congress-legislative-initiatives', ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET
      source_url = excluded.source_url,
      imported_at = excluded.imported_at,
      row_count = excluded.row_count
  `).run(datasetUrls.join('\n'), importedAt, records.length)
  database.exec('COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

const counts = database.prepare('SELECT status, COUNT(*) AS count FROM legislative_initiatives GROUP BY status ORDER BY count DESC').all()
database.close()
console.log(`Imported ${records.length} current legislative initiatives.`)
console.table(counts)
