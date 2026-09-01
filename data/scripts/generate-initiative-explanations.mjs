import crypto from 'node:crypto'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const model = process.env.CLOUDFLARE_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fast'
const promptVersion = 2
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='))
const limit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : 25

if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')
if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer')

const dataDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const database = new DatabaseSync(path.join(dataDirectory, 'parlamento.sqlite'))
const migrationsDirectory = path.join(dataDirectory, 'migrations')

for (const migration of fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort()) {
  database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'))
}

const initiatives = database.prepare(`
  WITH latest_votes AS (
    SELECT
      v.*,
      ROW_NUMBER() OVER (
        PARTITION BY v.expediente
        ORDER BY v.voted_on DESC, v.session_number DESC, v.vote_number DESC, v.id DESC
      ) AS recency
    FROM voting_events v
  )
  SELECT
    i.expediente,
    i.type,
    i.title,
    i.author,
    i.status,
    i.official_result,
    i.current_stage,
    v.voted_on,
    v.initiative_text,
    v.subgroup_title,
    v.vote_text,
    e.plain_title,
    e.summary,
    e.source_fingerprint
  FROM legislative_initiatives i
  LEFT JOIN latest_votes v
    ON v.expediente = SUBSTR(i.expediente, 1, LENGTH(i.expediente) - 5)
    AND v.recency = 1
  LEFT JOIN initiative_explanations e ON e.expediente = i.expediente
  ORDER BY (v.voted_on IS NOT NULL) DESC, COALESCE(v.voted_on, i.presented_on) DESC, i.expediente DESC
`).all()

function sourceData(initiative) {
  return Object.fromEntries(Object.entries({
    type: initiative.type,
    official_title: initiative.title,
    author: initiative.author,
    status: initiative.status,
    official_result: initiative.official_result,
    current_stage: initiative.current_stage,
    vote_subject: initiative.initiative_text,
    vote_stage: initiative.subgroup_title,
    vote_wording: initiative.vote_text,
  }).filter(([, value]) => value))
}

function fingerprint(source) {
  return crypto.createHash('sha256').update(JSON.stringify({ model, promptVersion, source })).digest('hex')
}

function words(value) {
  return value.trim().split(/\s+/).length
}

function validate(result) {
  if (!result || typeof result.plain_title !== 'string' || typeof result.summary !== 'string') {
    throw new Error('Model returned an invalid explanation')
  }

  const plainTitle = result.plain_title.replace(/\s+/g, ' ').trim().replace(/[.]$/, '')
  const summaryText = result.summary.replace(/\s+/g, ' ').trim()
  const summary = /[.!?]$/.test(summaryText) ? summaryText : `${summaryText}.`
  if (!plainTitle || !summary || words(plainTitle) > 12 || words(summary) > 35) {
    const error = new Error(`Model explanation exceeded its allowed length (title ${words(plainTitle)}, summary ${words(summary)})`)
    error.explanation = { plainTitle, summary }
    throw error
  }
  return { plainTitle, summary }
}

async function compressTitle({ plainTitle, summary }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Acorta titulares en español. Devuelve solo un titular de 8 palabras como máximo, sin comillas ni punto final. No añadas información.' },
        { role: 'user', content: `Titular: ${plainTitle}\nResumen: ${summary}` },
      ],
      max_tokens: 40,
      temperature: 0.1,
    }),
  })
  const body = await response.json()
  if (!response.ok || !body.success || typeof body.result?.response !== 'string') throw new Error('Could not shorten model title')
  return body.result.response.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().replace(/[.]$/, '')
}

async function requestExplanation(source, strict = false) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: [
            'Explica iniciativas del Congreso de España en español claro y neutral.',
            'Usa solo los datos facilitados: no añadas contexto, efectos, motivos ni hechos externos.',
            'plain_title: máximo 12 palabras, concreto, sin punto final ni jerga procesal innecesaria.',
            'Si el título oficial incluye "para", prioriza esa finalidad sobre el número de la ley.',
            'summary: una sola frase de máximo 35 palabras que explique qué plantea o cambia.',
            'Empieza summary con un verbo claro en presente y cuida la gramática.',
            'Si los datos solo dicen que se modifica una ley, di únicamente que la modifica.',
            'No añadas lugares, alcance ni detalles que no aparezcan en los datos.',
            'Si los datos no permiten afirmar una consecuencia, no la supongas.',
            strict ? 'Límite estricto: cuenta las palabras y reduce plain_title a 7 y summary a 25 como máximo.' : '',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(source) },
      ],
      max_tokens: 160,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            plain_title: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['plain_title', 'summary'],
        },
      },
    }),
  })
  const body = await response.json()
  if (!response.ok || !body.success) {
    const message = body.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}`
    throw new Error(`Cloudflare Workers AI: ${message}`)
  }
  const result = typeof body.result?.response === 'string'
    ? JSON.parse(body.result.response.replace(/^```json\s*|\s*```$/g, ''))
    : body.result?.response
  return validate(result)
}

async function generate(source) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await requestExplanation(source, attempt > 1)
    } catch (error) {
      lastError = error
      if (error.explanation && words(error.explanation.summary) <= 35) {
        try {
          const plainTitle = await compressTitle(error.explanation)
          return validate({ plain_title: plainTitle, summary: error.explanation.summary })
        } catch {
          // Retry the full explanation with stricter limits.
        }
      }
    }
  }
  throw lastError
}

const pending = initiatives.map((initiative) => {
  const source = sourceData(initiative)
  return { initiative, source, fingerprint: fingerprint(source) }
}).filter(({ initiative, fingerprint }) => (
  initiative.source_fingerprint !== fingerprint
  || words(initiative.plain_title || '') > 12
  || words(initiative.summary || '') > 35
)).slice(0, limit)

const save = database.prepare(`
  INSERT INTO initiative_explanations (
    expediente, plain_title, summary, source_fingerprint, model, generated_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (expediente) DO UPDATE SET
    plain_title = excluded.plain_title,
    summary = excluded.summary,
    source_fingerprint = excluded.source_fingerprint,
    model = excluded.model,
    generated_at = excluded.generated_at
`)

let generated = 0
const failures = []
for (const { initiative, source, fingerprint: sourceFingerprint } of pending) {
  try {
    const explanation = await generate(source)
    save.run(
      initiative.expediente,
      explanation.plainTitle,
      explanation.summary,
      sourceFingerprint,
      model,
      new Date().toISOString(),
    )
    generated++
    console.log(`${generated}/${pending.length} ${initiative.expediente}: ${explanation.plainTitle}`)
  } catch (error) {
    failures.push(initiative.expediente)
    console.error(`Skipped ${initiative.expediente}: ${error.message}`)
  }
}

database.close()
console.log(generated ? `Generated ${generated} explanations.` : 'All explanations are current.')
if (failures.length) {
  console.error(`Failed ${failures.length}: ${failures.join(', ')}`)
  process.exitCode = 1
}
