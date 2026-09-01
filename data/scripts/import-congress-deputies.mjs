import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const catalogUrl = 'https://www.congreso.es/es/opendata/diputados'
const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = path.join(dataDirectory, 'parlamento.sqlite')
const migrationsDirectory = path.join(dataDirectory, 'migrations')

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function date(value) {
  const match = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null
}

async function downloadCurrentDeputies() {
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.goto(catalogUrl, { waitUntil: 'domcontentloaded' })

    const link = page.locator('a[href*="DiputadosActivos"][href$=".json"]').first()
    await link.waitFor()
    const sourceUrl = new URL(await link.getAttribute('href'), catalogUrl).href
    const response = await page.request.get(sourceUrl)

    if (!response.ok()) {
      throw new Error(`Congress export returned HTTP ${response.status()}`)
    }

    return { records: await response.json(), sourceUrl }
  } finally {
    await browser.close()
  }
}

function validate(records) {
  if (!Array.isArray(records) || records.length < 250 || records.length > 400) {
    throw new Error(`Unexpected deputy count: ${records?.length ?? 'not an array'}`)
  }

  const required = ['NOMBRE', 'CIRCUNSCRIPCION', 'FORMACIONELECTORAL', 'GRUPOPARLAMENTARIO']
  const names = new Set()

  for (const record of records) {
    for (const field of required) {
      if (!text(record[field])) throw new Error(`Missing ${field} in Congress export`)
    }

    const name = text(record.NOMBRE)
    if (names.has(name)) throw new Error(`Duplicate deputy name: ${name}`)
    names.add(name)
  }
}

function updateDatabase(records, sourceUrl) {
  const importedAt = new Date().toISOString()
  const database = new DatabaseSync(databasePath)
  for (const migration of fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'))
  }

  const insertParty = database.prepare('INSERT INTO parties (code) VALUES (?) ON CONFLICT (code) DO NOTHING')
  const selectParty = database.prepare('SELECT id FROM parties WHERE code = ?')
  const insertGroup = database.prepare('INSERT INTO parliamentary_groups (name) VALUES (?) ON CONFLICT (name) DO NOTHING')
  const selectGroup = database.prepare('SELECT id FROM parliamentary_groups WHERE name = ?')
  const upsertDeputy = database.prepare(`
    INSERT INTO deputies (
      name, constituency, party_id, parliamentary_group_id, full_status_on,
      joined_on, group_joined_on, group_left_on, biography, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET
      constituency = excluded.constituency,
      party_id = excluded.party_id,
      parliamentary_group_id = excluded.parliamentary_group_id,
      full_status_on = excluded.full_status_on,
      joined_on = excluded.joined_on,
      group_joined_on = excluded.group_joined_on,
      group_left_on = excluded.group_left_on,
      biography = excluded.biography,
      updated_at = excluded.updated_at
  `)

  database.exec('BEGIN IMMEDIATE; CREATE TEMP TABLE current_import_names (name TEXT PRIMARY KEY)')
  const markImported = database.prepare('INSERT INTO current_import_names (name) VALUES (?)')

  try {
    for (const record of records) {
      const name = text(record.NOMBRE)
      const partyCode = text(record.FORMACIONELECTORAL)
      const groupName = text(record.GRUPOPARLAMENTARIO)

      insertParty.run(partyCode)
      insertGroup.run(groupName)
      markImported.run(name)
      upsertDeputy.run(
        name,
        text(record.CIRCUNSCRIPCION),
        selectParty.get(partyCode).id,
        selectGroup.get(groupName).id,
        date(record.FECHACONDICIONPLENA),
        date(record.FECHAALTA),
        date(record.FECHAALTAENGRUPOPARLAMENTARIO),
        date(record.FECHABAJAENGRUPOPARLAMENTARIO),
        text(record.BIOGRAFIA) || null,
        importedAt,
      )
    }

    database.exec(`
      DELETE FROM deputies WHERE name NOT IN (SELECT name FROM current_import_names);
      DELETE FROM parties WHERE id NOT IN (SELECT party_id FROM deputies);
      DELETE FROM parliamentary_groups WHERE id NOT IN (SELECT parliamentary_group_id FROM deputies);
    `)
    database.prepare(`
      INSERT INTO import_state (source, source_url, imported_at, row_count)
      VALUES ('congress-current-deputies', ?, ?, ?)
      ON CONFLICT (source) DO UPDATE SET
        source_url = excluded.source_url,
        imported_at = excluded.imported_at,
        row_count = excluded.row_count
    `).run(sourceUrl, importedAt, records.length)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

  const counts = Object.fromEntries(
    ['deputies', 'parties', 'parliamentary_groups'].map((table) => [
      table,
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    ]),
  )
  database.close()
  return counts
}

const { records, sourceUrl } = await downloadCurrentDeputies()
validate(records)
const counts = updateDatabase(records, sourceUrl)

console.log(`Imported ${counts.deputies} deputies, ${counts.parties} parties, and ${counts.parliamentary_groups} groups.`)
