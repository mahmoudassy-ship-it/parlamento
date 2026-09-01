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
