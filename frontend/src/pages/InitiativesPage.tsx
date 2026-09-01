import { type Initiative, useApi } from '../lib/api'

const statusLabels: Record<Initiative['status'], string> = {
  approved: 'Aprobada',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
  lapsed: 'Decaída',
  merged: 'Integrada en otra',
  closed: 'Cerrada',
  pending: 'En trámite',
}

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
      {initiatives.map((initiative) => (
        <article className="initiative" key={initiative.expediente}>
          <div className="initiative-meta">
            <span className={`initiative-status status-${initiative.status}`}>{statusLabels[initiative.status]}</span>
            {initiative.presented_on && <time dateTime={initiative.presented_on}>{formatDate(initiative.presented_on)}</time>}
            <span>{initiative.expediente.replace(/\/0000$/, '')}</span>
          </div>
          <h2>{initiative.title}</h2>
          {initiative.description && <p>{initiative.description}</p>}
          <div className="initiative-detail">
            <span>{initiative.author || initiative.type}</span>
            <a href={initiative.official_url}>Congreso</a>
          </div>
          {initiative.status === 'pending' && initiative.current_stage && (
            <p className="initiative-stage">{initiative.current_stage}</p>
          )}
        </article>
      ))}
    </main>
  )
}
