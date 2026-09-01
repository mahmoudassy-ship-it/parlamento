import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const userAgent = 'Parlamento/0.1 (https://parlamento.eufoniadiversity.com)'
const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = path.join(dataDirectory, 'parlamento.sqlite')
const migrationsDirectory = path.join(dataDirectory, 'migrations')

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .sort()
    .join(' ')
}

function displayName(name) {
  return name.includes(',') ? name.split(',').reverse().map((part) => part.trim()).join(' ') : name
}

function cleanMetadata(value) {
  return value
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || null
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function getJson(url, attempt = 0) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent } })
  if ((response.status === 429 || response.status === 503) && attempt < 5) {
    const retryAfter = Number(response.headers.get('retry-after')) * 1000
    await wait(retryAfter || 1000 * 2 ** attempt)
    return getJson(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return response.json()
}

async function currentCongressCandidates() {
  const query = `
    SELECT DISTINCT ?person ?personLabel ?alias ?image WHERE {
      ?person p:P39 ?position; wdt:P18 ?image.
      ?position ps:P39 wd:Q18171345.
      OPTIONAL {
        ?person skos:altLabel ?alias.
        FILTER(LANG(?alias) IN ("es", "en"))
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
    }
  `
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`
  const data = await getJson(url)
  const candidates = new Map()

  for (const row of data.results.bindings) {
    const id = row.person.value.split('/').pop()
    const candidate = candidates.get(id) || {
      id,
      image: decodeURIComponent(row.image.value.split('/').pop()),
      names: new Set(),
    }
    candidate.names.add(normalize(row.personLabel.value))
    if (row.alias) candidate.names.add(normalize(row.alias.value))
    candidates.set(id, candidate)
  }

  return [...candidates.values()]
}

async function searchExactCandidate(name) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: displayName(name),
    language: 'es',
    uselang: 'es',
    type: 'item',
    limit: '5',
    format: 'json',
  })
  const data = await getJson(`https://www.wikidata.org/w/api.php?${params}`)
  const expected = normalize(displayName(name))
  const political = /pol[ií]tic|diputad|senador|ministro|alcald/i
  const exact = data.search.filter((item) => {
    const names = [item.label, ...(item.aliases || [])].filter(Boolean).map(normalize)
    return names.includes(expected) && political.test(item.description || '')
  })
  return exact.length === 1 ? exact[0].id : null
}

async function searchMissing(deputies, matchedIds) {
  const found = new Map()

  for (const deputy of deputies) {
    const wikidataId = await searchExactCandidate(deputy.name)
    if (wikidataId && !matchedIds.has(wikidataId)) found.set(deputy.id, wikidataId)
    await wait(250)
  }

  return found
}

async function entityImages(ids) {
  const images = new Map()

  for (let index = 0; index < ids.length; index += 50) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: ids.slice(index, index + 50).join('|'),
      props: 'claims',
      format: 'json',
    })
    const data = await getJson(`https://www.wikidata.org/w/api.php?${params}`)
    for (const entity of Object.values(data.entities)) {
      const isHuman = entity.claims?.P31?.some((claim) => claim.mainsnak?.datavalue?.value?.id === 'Q5')
      const image = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      if (isHuman && image) images.set(entity.id, image)
    }
  }

  return images
}

async function commonsMetadata(files) {
  const metadata = new Map()

  for (let index = 0; index < files.length; index += 50) {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'imageinfo',
      titles: files.slice(index, index + 50).map((file) => `File:${file}`).join('|'),
      iiprop: 'url|extmetadata',
      iiurlwidth: '160',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      iiextmetadatalanguage: 'en',
      format: 'json',
    })
    const data = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`)

    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0]
      const file = page.title.replace(/^File:/, '')
      const licenseName = cleanMetadata(info?.extmetadata?.LicenseShortName?.value)
      const licenseUrl = cleanMetadata(info?.extmetadata?.LicenseUrl?.value)
      if (!info?.thumburl || !licenseName || !licenseUrl) continue
      metadata.set(file, {
        imageUrl: info.thumburl.replace(/^http:/, 'https:'),
        pageUrl: info.descriptionurl.replace(/^http:/, 'https:'),
        licenseName,
        licenseUrl,
        artist: cleanMetadata(info.extmetadata?.Artist?.value),
        credit: cleanMetadata(info.extmetadata?.Credit?.value),
      })
    }
  }

  return metadata
}

const database = new DatabaseSync(databasePath)
for (const migration of fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'))
}

const deputies = database.prepare('SELECT id, name FROM deputies ORDER BY name').all()
if (!deputies.length) throw new Error('Import Congress deputies before importing photos')

const candidates = await currentCongressCandidates()
const matches = new Map()
const matchedWikidataIds = new Set()

for (const deputy of deputies) {
  const expected = normalize(displayName(deputy.name))
  const exact = candidates.filter((candidate) => candidate.names.has(expected))
  if (exact.length !== 1) continue
  matches.set(deputy.id, { wikidataId: exact[0].id, file: exact[0].image })
  matchedWikidataIds.add(exact[0].id)
}

const missing = deputies.filter((deputy) => !matches.has(deputy.id))
const searched = await searchMissing(missing, matchedWikidataIds)
const searchedImages = await entityImages([...new Set(searched.values())])
for (const [deputyId, wikidataId] of searched) {
  const file = searchedImages.get(wikidataId)
  if (file) matches.set(deputyId, { wikidataId, file })
}

const commons = await commonsMetadata([...new Set([...matches.values()].map((match) => match.file))])
const importedAt = new Date().toISOString()
const upsert = database.prepare(`
  INSERT INTO deputy_images (
    deputy_id, wikidata_id, commons_file, image_url, image_page_url,
    license_name, license_url, artist, credit, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (deputy_id) DO UPDATE SET
    wikidata_id = excluded.wikidata_id,
    commons_file = excluded.commons_file,
    image_url = excluded.image_url,
    image_page_url = excluded.image_page_url,
    license_name = excluded.license_name,
    license_url = excluded.license_url,
    artist = excluded.artist,
    credit = excluded.credit,
    updated_at = excluded.updated_at
`)

database.exec('BEGIN IMMEDIATE; CREATE TEMP TABLE imported_photo_ids (deputy_id INTEGER PRIMARY KEY)')
try {
  const markImported = database.prepare('INSERT INTO imported_photo_ids (deputy_id) VALUES (?)')
  for (const [deputyId, match] of matches) {
    const image = commons.get(match.file)
    if (!image) continue
    upsert.run(
      deputyId,
      match.wikidataId,
      match.file,
      image.imageUrl,
      image.pageUrl,
      image.licenseName,
      image.licenseUrl,
      image.artist,
      image.credit,
      importedAt,
    )
    markImported.run(deputyId)
  }
  database.exec('DELETE FROM deputy_images WHERE deputy_id NOT IN (SELECT deputy_id FROM imported_photo_ids); COMMIT')
} catch (error) {
  database.exec('ROLLBACK')
  throw error
}

const count = database.prepare('SELECT COUNT(*) AS count FROM deputy_images').get().count
database.close()
console.log(`Imported ${count} licensed deputy photos; ${deputies.length - count} deputies use placeholders.`)
