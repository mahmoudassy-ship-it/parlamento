import fs from 'node:fs'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const frontendDirectory = path.join(projectDirectory, 'frontend', 'dist')
const database = new DatabaseSync(path.join(projectDirectory, 'data', 'parlamento.sqlite'), { readOnly: true })
const port = Number(process.env.PORT || 3000)

const deputies = database.prepare(`
  SELECT
    d.id,
    d.name,
    p.code AS party,
    g.name AS parliamentary_group,
    i.image_url,
    i.image_page_url,
    i.license_name,
    i.license_url,
    COALESCE(i.credit, i.artist) AS attribution
  FROM deputies d
  JOIN parties p ON p.id = d.party_id
  JOIN parliamentary_groups g ON g.id = d.parliamentary_group_id
  LEFT JOIN deputy_images i ON i.deputy_id = d.id
  ORDER BY d.name
`)

const parties = database.prepare(`
  SELECT
    p.id,
    p.code,
    p.name,
    COUNT(*) AS seats,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM deputies), 1) AS share
  FROM parties p
  JOIN deputies d ON d.party_id = p.id
  GROUP BY p.id
  ORDER BY seats DESC, p.code
`)

const initiatives = database.prepare(`
  SELECT
    i.expediente,
    i.type,
    i.title,
    i.description,
    i.author,
    i.presented_on,
    i.status,
    i.official_result,
    i.current_stage,
    i.official_url,
    e.plain_title,
    e.summary AS plain_summary,
    e.generated_at AS explanation_generated_at
  FROM legislative_initiatives i
  LEFT JOIN initiative_explanations e ON e.expediente = i.expediente
  ORDER BY i.presented_on DESC, i.expediente DESC
`)

const initiativeByExpediente = database.prepare(`
  SELECT
    i.expediente,
    i.type,
    i.title,
    i.description,
    i.author,
    i.presented_on,
    i.status,
    i.official_result,
    i.current_stage,
    i.official_url,
    e.plain_title,
    e.summary AS plain_summary,
    e.generated_at AS explanation_generated_at
  FROM legislative_initiatives i
  LEFT JOIN initiative_explanations e ON e.expediente = i.expediente
  WHERE i.expediente = ?
`)

const initiativeDocuments = database.prepare(`
  SELECT kind, url
  FROM initiative_documents
  WHERE expediente = ?
  ORDER BY id
`)

const latestInitiativeVotes = database.prepare(`
  WITH matched_votes AS (
    SELECT
      i.expediente AS initiative_expediente,
      v.*,
      ROW_NUMBER() OVER (
        PARTITION BY i.expediente
        ORDER BY v.voted_on DESC, v.session_number DESC, v.vote_number DESC, v.id DESC
      ) AS recency
    FROM legislative_initiatives i
    JOIN voting_events v
      ON v.expediente = SUBSTR(i.expediente, 1, LENGTH(i.expediente) - 5)
  )
  SELECT
    v.initiative_expediente,
    v.id,
    v.voted_on,
    v.title,
    v.initiative_text,
    v.subgroup_title,
    v.vote_text,
    v.yes_count,
    v.no_count,
    v.abstain_count,
    v.not_voting_count,
    v.source_url,
    mv.parliamentary_group_code AS group_code,
    SUM(CASE WHEN mv.choice = 'yes' THEN 1 ELSE 0 END) AS group_yes_count,
    SUM(CASE WHEN mv.choice = 'no' THEN 1 ELSE 0 END) AS group_no_count,
    SUM(CASE WHEN mv.choice = 'abstain' THEN 1 ELSE 0 END) AS group_abstain_count,
    SUM(CASE WHEN mv.choice = 'not_voting' THEN 1 ELSE 0 END) AS group_not_voting_count
  FROM matched_votes v
  LEFT JOIN member_votes mv
    ON mv.voting_event_id = v.id
    AND mv.parliamentary_group_code IN ('GP', 'GS', 'GVOX', 'GSUMAR')
  WHERE v.recency = 1
  GROUP BY v.id, mv.parliamentary_group_code
  ORDER BY v.initiative_expediente, mv.parliamentary_group_code
`)

const votesByExpediente = database.prepare(`
  SELECT
    v.id,
    v.voted_on,
    v.title,
    v.initiative_text,
    v.subgroup_title,
    v.vote_text,
    v.yes_count,
    v.no_count,
    v.abstain_count,
    v.not_voting_count,
    v.source_url,
    mv.parliamentary_group_code AS group_code,
    SUM(CASE WHEN mv.choice = 'yes' THEN 1 ELSE 0 END) AS group_yes_count,
    SUM(CASE WHEN mv.choice = 'no' THEN 1 ELSE 0 END) AS group_no_count,
    SUM(CASE WHEN mv.choice = 'abstain' THEN 1 ELSE 0 END) AS group_abstain_count,
    SUM(CASE WHEN mv.choice = 'not_voting' THEN 1 ELSE 0 END) AS group_not_voting_count
  FROM voting_events v
  LEFT JOIN member_votes mv
    ON mv.voting_event_id = v.id
    AND mv.parliamentary_group_code IN ('GP', 'GS', 'GVOX', 'GSUMAR')
  WHERE v.expediente = ?
  GROUP BY v.id, mv.parliamentary_group_code
  ORDER BY v.voted_on DESC, v.session_number DESC, v.vote_number DESC, v.id DESC
`)

const majorGroups = new Map([
  ['GP', 'PP'],
  ['GS', 'PSOE'],
  ['GVOX', 'VOX'],
  ['GSUMAR', 'SUMAR'],
])
const majorGroupOrder = new Map([...majorGroups.keys()].map((code, index) => [code, index]))

function groupPosition(group) {
  const castChoices = [
    ['yes', group.yes_count],
    ['no', group.no_count],
    ['abstain', group.abstain_count],
  ].filter(([, count]) => count > 0)

  if (castChoices.length === 1) return castChoices[0][0]
  if (castChoices.length === 0 && group.not_voting_count > 0) return 'not_voting'
  return 'mixed'
}

function collectVotes(rows, initiativeKey) {
  const votes = []
  const byId = new Map()
  const initiativeVotes = new Map()

  for (const row of rows) {
    let vote = byId.get(row.id)

    if (!vote) {
      vote = {
        id: row.id,
        voted_on: row.voted_on,
        title: row.title,
        initiative_text: row.initiative_text,
        subgroup_title: row.subgroup_title,
        vote_text: row.vote_text,
        yes_count: row.yes_count,
        no_count: row.no_count,
        abstain_count: row.abstain_count,
        not_voting_count: row.not_voting_count,
        source_url: row.source_url,
        groups: [],
      }
      byId.set(row.id, vote)
      votes.push(vote)
      if (initiativeKey) initiativeVotes.set(row[initiativeKey], vote)
    }

    const label = majorGroups.get(row.group_code)
    if (!label) continue

    const group = {
      code: row.group_code,
      label,
      yes_count: row.group_yes_count,
      no_count: row.group_no_count,
      abstain_count: row.group_abstain_count,
      not_voting_count: row.group_not_voting_count,
    }
    group.position = groupPosition(group)
    vote.groups.push(group)
  }

  for (const vote of votes) {
    vote.groups.sort((a, b) => majorGroupOrder.get(a.code) - majorGroupOrder.get(b.code))
  }

  return initiativeKey ? initiativeVotes : votes
}

function listInitiatives() {
  const latestVotes = collectVotes(latestInitiativeVotes.all(), 'initiative_expediente')
  return initiatives.all().map((initiative) => ({
    ...initiative,
    latest_vote: latestVotes.get(initiative.expediente) || null,
  })).sort((a, b) => {
    if (a.latest_vote && !b.latest_vote) return -1
    if (!a.latest_vote && b.latest_vote) return 1
    return (b.latest_vote?.voted_on || b.presented_on || '').localeCompare(a.latest_vote?.voted_on || a.presented_on || '')
  })
}

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

function send(response, status, body, contentType) {
  response.writeHead(status, { 'Content-Type': contentType })
  response.end(body)
}

function serveFile(response, file) {
  fs.readFile(file, (error, content) => {
    if (error) return send(response, 404, 'Not found', 'text/plain; charset=utf-8')
    send(response, 200, content, types[path.extname(file)] || 'application/octet-stream')
  })
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (url.pathname === '/api/deputies') {
    return send(response, 200, JSON.stringify(deputies.all()), types['.json'])
  }

  if (url.pathname === '/api/parties') {
    return send(response, 200, JSON.stringify(parties.all()), types['.json'])
  }

  if (url.pathname === '/api/initiatives') {
    return send(response, 200, JSON.stringify(listInitiatives()), types['.json'])
  }

  const initiativeMatch = url.pathname.match(/^\/api\/initiatives\/([0-9]{3}-[0-9]{6}-[0-9]{4})$/)
  if (initiativeMatch) {
    const expediente = initiativeMatch[1].replaceAll('-', '/')
    const initiative = initiativeByExpediente.get(expediente)

    if (!initiative) {
      return send(response, 404, JSON.stringify({ error: 'Not found' }), types['.json'])
    }

    const votes = collectVotes(votesByExpediente.all(expediente.slice(0, -5)))
    return send(response, 200, JSON.stringify({
      initiative: {
        ...initiative,
        latest_vote: votes[0] || null,
      },
      documents: initiativeDocuments.all(expediente),
      votes,
    }), types['.json'])
  }

  if (url.pathname.startsWith('/api/initiatives/')) {
    return send(response, 404, JSON.stringify({ error: 'Not found' }), types['.json'])
  }

  if (url.pathname === '/health') {
    return send(response, 200, 'ok', 'text/plain; charset=utf-8')
  }

  const requestedFile = path.resolve(frontendDirectory, `.${decodeURIComponent(url.pathname)}`)
  if (requestedFile.startsWith(`${frontendDirectory}${path.sep}`) && fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
    return serveFile(response, requestedFile)
  }

  serveFile(response, path.join(frontendDirectory, 'index.html'))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Parlamento listening on http://127.0.0.1:${port}`)
})

function close() {
  server.close(() => {
    database.close()
    process.exit(0)
  })
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
