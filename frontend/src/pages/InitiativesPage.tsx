import { Link } from '@tanstack/react-router'
import { InitiativeStatus } from '../components/InitiativeStatus'
import { CompactGroupVotes } from '../components/VoteBreakdown'
import { type Initiative, useApi } from '../lib/api'
import { conciseInitiativeTitle } from '../lib/initiative-title'

function formatDate(date: string | null) {
  if (!date) return null
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

export function InitiativesPage() {
  const { data: initiatives, error } = useApi<Initiative[]>('/api/initiatives')

  if (error) return <main className="page"><p role="alert">No se pudieron cargar las iniciativas.</p></main>
  if (!initiatives) return <main className="page"><p>Cargando…</p></main>

  return (
    <main className="page initiatives-page">
      <h1 className="visually-hidden">Iniciativas legislativas</h1>
      {initiatives.map((initiative) => {
        const summary = initiative.plain_summary || initiative.description
        return (
          <Link
            className="initiative-link"
            key={initiative.expediente}
            params={{ slug: initiative.expediente.replaceAll('/', '-') }}
            to="/iniciativas/$slug"
          >
            <article className="initiative">
              <div className="initiative-copy">
                <h2>{initiative.plain_title || conciseInitiativeTitle(initiative.title)}</h2>
                <div className="initiative-meta">
                  <span>{initiative.author || initiative.type}</span>
                  {initiative.presented_on && <time dateTime={initiative.presented_on}>{formatDate(initiative.presented_on)}</time>}
                  <span>{initiative.expediente.replace(/\/0000$/, '')}</span>
                  {initiative.plain_title && <span aria-label="Texto generado automáticamente a partir de datos oficiales" title="Texto generado automáticamente a partir de datos oficiales">IA</span>}
                </div>
                {summary && <p>{summary}</p>}
              </div>
              <InitiativeStatus status={initiative.status} />
              {initiative.latest_vote && <CompactGroupVotes groups={initiative.latest_vote.groups} />}
            </article>
          </Link>
        )
      })}
    </main>
  )
}
