import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import unzipper from 'unzipper'

const catalogUrl = 'https://www.congreso.es/es/opendata/votaciones'
const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = path.join(dataDirectory, 'parlamento.sqlite')
const migrationsDirectory = path.join(dataDirectory, 'migrations')
const cacheDirectory = path.join(dataDirectory, 'cache', 'votes')
const listingCacheDirectory = path.join(cacheDirectory, 'dates')

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() || null : null
}

function integer(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new Error(`Invalid count: ${value}`)
  return number
}

function date(value) {
  const match = text(value)?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null
}

function choice(value) {
  const choices = { 'Sí': 'yes', No: 'no', 'Abstención': 'abstain', 'No vota': 'not_voting' }
  const normalized = choices[text(value)]
  if (!normalized) throw new Error(`Unexpected vote choice: ${value}`)
  return normalized
}

function normalizedName(value) {
  return text(value)?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

async function pool(items, concurrency, task) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  }))
  return results
}

async function retry(task, description) {
  let lastError
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
  throw new Error(`${description}: ${lastError.message}`)
}

async function download() {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const catalog = await context.newPage()
    await retry(async () => {
      await catalog.goto(catalogUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await catalog.waitForFunction(() => Array.isArray(globalThis.diasVotaciones) && globalThis.diasVotaciones.length > 100, null, { timeout: 30_000 })
    }, 'Could not load voting calendar')
    const dates = await catalog.evaluate(() => globalThis.diasVotaciones || [])
    if (!Array.isArray(dates) || dates.length < 100) throw new Error(`Unexpected voting date count: ${dates?.length}`)
    await catalog.close()

    fs.mkdirSync(listingCacheDirectory, { recursive: true })
    let pagesDone = 0
    const listings = await pool(dates, 1, async (rawDate) => {
      const page = await context.newPage()
      try {
        const compactDate = String(rawDate).padStart(8, '0')
        const listingCachePath = path.join(listingCacheDirectory, `${compactDate}.json`)
        if (fs.existsSync(listingCachePath)) {
          pagesDone++
          return JSON.parse(fs.readFileSync(listingCachePath, 'utf8'))
        }
        const formatted = `${compactDate.slice(6, 8)}/${compactDate.slice(4, 6)}/${compactDate.slice(0, 4)}`
        const url = `${catalogUrl}?${new URLSearchParams({ targetDate: formatted, targetLegislatura: 'XV' })}`
        const listing = await retry(async () => {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
          const links = await page.locator('a[href$=".json"]').evaluateAll((anchors) => anchors.map((anchor) => {
            let container = anchor.parentElement
            while (container && !/Núm\.\s*expte\./i.test(container.innerText || '')) container = container.parentElement
            const expediente = container?.innerText.match(/Núm\.\s*expte\.\s*([0-9]{3}\/[0-9]{6})/i)?.[1] || null
            return { sourceUrl: anchor.href, expediente }
          }))
          const href = await page.locator('a[href$=".zip"]').first().getAttribute('href', { timeout: 10_000 }).catch(() => null)
          const zipUrl = href ? new URL(href, catalogUrl).href : null
          if (!zipUrl?.includes(`/${compactDate}/`)) throw new Error(`Wrong or missing session archive for ${formatted}`)
          return { links, zipUrl }
        }, `Could not load ${formatted}`)
        pagesDone++
        if (pagesDone % 10 === 0) console.log(`Read ${pagesDone}/${dates.length} voting dates…`)
        fs.writeFileSync(listingCachePath, JSON.stringify(listing))
        return listing
      } finally {
        await page.close()
      }
    })

    const expedientes = new Map(listings.flatMap((listing) => listing.links).map((link) => {
      const match = link.sourceUrl.match(/Sesion0*(\d+)\/\d+\/Votacion0*(\d+)\//i)
      return [match ? `${Number(match[1])}/${Number(match[2])}` : link.sourceUrl, link.expediente]
    }))
    let archivesDone = 0
    fs.mkdirSync(cacheDirectory, { recursive: true })
    const records = (await pool(listings.map((listing) => listing.zipUrl), 2, async (zipUrl) => {
      const cachePath = path.join(cacheDirectory, path.basename(new URL(zipUrl).pathname))
      const buffer = fs.existsSync(cachePath) ? fs.readFileSync(cachePath) : await retry(async () => {
        const response = await context.request.get(zipUrl, { timeout: 120_000 })
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`)
        const body = await response.body()
        fs.writeFileSync(cachePath, body)
        return body
      }, `Could not download ${zipUrl}`)
      const directory = await unzipper.Open.buffer(buffer)
      const extracted = await Promise.all(directory.files.filter((file) => file.path.toLowerCase().endsWith('.json')).map(async (file) => {
        const record = JSON.parse((await file.buffer()).toString('utf8'))
        const key = `${Number(record.informacion?.sesion)}/${Number(record.informacion?.numeroVotacion)}`
        return { sourceUrl: `${zipUrl}#${file.path}`, expediente: expedientes.get(key) || null, record }
      }))
      archivesDone++
      if (archivesDone % 20 === 0) console.log(`Downloaded ${archivesDone}/${listings.length} session archives…`)
      return extracted
    })).flat()
    if (records.length < 1_500) throw new Error(`Unexpected roll-call count: ${records.length}`)
    return { records, votingDates: dates.length }
  } finally {
    await browser.close()
  }
}

function validate(records) {
  const keys = new Set()
  for (const { record, sourceUrl } of records) {
    const info = record?.informacion
    const totals = record?.totales
    if (!info || !totals || !date(info.fecha) || !text(info.titulo)) throw new Error(`Incomplete roll call: ${sourceUrl}`)
    const key = `${info.sesion}/${info.numeroVotacion}`
    if (keys.has(key)) throw new Error(`Duplicate roll call: ${key}`)
    keys.add(key)
    for (const vote of record.votaciones || []) {
      if (!text(vote.diputado)) throw new Error(`Missing deputy name: ${sourceUrl}`)
      choice(vote.voto)
    }
  }
}

const { records, votingDates } = await download()
validate(records)

const database = new DatabaseSync(databasePath)
for (const migration of fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'))
}

const deputyMatches = new Map()
for (const deputy of database.prepare('SELECT id, name FROM deputies').all()) {
  const key = normalizedName(deputy.name)
  deputyMatches.set(key, deputyMatches.has(key) ? null : deputy.id)
}

const importedAt = new Date().toISOString()
const upsertEvent = database.prepare(`
  INSERT INTO voting_events (
    legislature, session_number, vote_number, voted_on, expediente, title,
    initiative_text, subgroup_title, vote_text, assent, present_count,
    yes_count, no_count, abstain_count, not_voting_count, source_url, updated_at
  ) VALUES (15, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (legislature, session_number, vote_number) DO UPDATE SET
    voted_on = excluded.voted_on, expediente = excluded.expediente, title = excluded.title,
    initiative_text = excluded.initiative_text, subgroup_title = excluded.subgroup_title,
    vote_text = excluded.vote_text, assent = excluded.assent, present_count = excluded.present_count,
    yes_count = excluded.yes_count, no_count = excluded.no_count,
    abstain_count = excluded.abstain_count, not_voting_count = excluded.not_voting_count,
    source_url = excluded.source_url, updated_at = excluded.updated_at
  RETURNING id
`)
const clearMemberVotes = database.prepare('DELETE FROM member_votes WHERE voting_event_id = ?')
const insertMemberVote = database.prepare(`
  INSERT INTO member_votes (
    voting_event_id, deputy_id, member_name, parliamentary_group_code, seat, choice
  ) VALUES (?, ?, ?, ?, ?, ?)
`)
database.exec('BEGIN IMMEDIATE; CREATE TEMP TABLE imported_voting_event_ids (id INTEGER PRIMARY KEY)')
const markImported = database.prepare('INSERT INTO imported_voting_event_ids (id) VALUES (?)')
try {
  for (const { record, sourceUrl, expediente } of records) {
    const info = record.informacion
    const totals = record.totales
    const eventId = upsertEvent.get(
      integer(info.sesion), integer(info.numeroVotacion), date(info.fecha), expediente,
      text(info.titulo), text(info.textoExpediente), text(info.tituloSubGrupo),
      text(info.textoSubGrupo), text(totals.asentimiento), integer(totals.presentes),
      integer(totals.afavor), integer(totals.enContra), integer(totals.abstenciones),
      integer(totals.noVotan), sourceUrl, importedAt,
    ).id
    markImported.run(eventId)
    clearMemberVotes.run(eventId)
    for (const vote of record.votaciones || []) {
      insertMemberVote.run(
        eventId, deputyMatches.get(normalizedName(vote.diputado)) || null,
        text(vote.diputado), text(vote.grupo), text(vote.asiento), choice(vote.voto),
      )
    }
  }
  database.exec('DELETE FROM voting_events WHERE id NOT IN (SELECT id FROM imported_voting_event_ids)')
  database.prepare(`
    INSERT INTO import_state (source, source_url, imported_at, row_count)
    VALUES ('congress-roll-call-votes', ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET
      source_url = excluded.source_url, imported_at = excluded.imported_at, row_count = excluded.row_count
  `).run(catalogUrl, importedAt, records.length)
  database.exec('COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

const memberVoteCount = database.prepare('SELECT COUNT(*) AS count FROM member_votes').get().count
const matchedCount = database.prepare('SELECT COUNT(*) AS count FROM member_votes WHERE deputy_id IS NOT NULL').get().count
database.close()
console.log(`Imported ${records.length} roll calls from ${votingDates} voting dates and ${memberVoteCount} member votes.`)
console.log(`${matchedCount} member votes matched the current deputy snapshot; historical names remain intact.`)
