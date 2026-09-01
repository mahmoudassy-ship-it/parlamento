import { useState } from 'react'
import { InitiativeStatus } from '../components/InitiativeStatus'
import { GroupVoteTable, VoteHemicycle, VoteTotals } from '../components/VoteBreakdown'
import { type InitiativeDetail, useApi } from '../lib/api'
import { conciseInitiativeTitle } from '../lib/initiative-title'

function formatDate(date: string | null) {
  if (!date) return null
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`))
}

export function InitiativeDetailPage({ slug }: { slug: string }) {
  const { data, error } = useApi<InitiativeDetail>(`/api/initiatives/${slug}`)
  const [tab, setTab] = useState<'details' | 'result'>('details')

  if (error) return <main className="page"><p role="alert">No se pudo cargar la iniciativa.</p></main>
  if (!data) return <main className="page"><p>Cargando…</p></main>

  const { initiative, documents, votes } = data
  const latestVote = votes[0]
  const summary = initiative.plain_summary || initiative.description
  const moveTab = (next: 'details' | 'result') => {
    setTab(next)
    requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus())
  }

  return (
    <main className="page initiative-page">
      <div className="initiative-heading">
        <p>{initiative.author || initiative.type}</p>
        <InitiativeStatus status={initiative.status} />
      </div>
      <h1>{initiative.plain_title || conciseInitiativeTitle(initiative.title)}</h1>
      {initiative.plain_title && <p className="explanation-note">Versión automática basada en datos oficiales.</p>}
      <p className="official-title">Título oficial: {initiative.title}</p>
      <p className="detail-meta">
        <span>{initiative.expediente.replace(/\/0000$/, '')}</span>
        {initiative.presented_on && <time dateTime={initiative.presented_on}>{formatDate(initiative.presented_on)}</time>}
      </p>
      {summary && <p className="initiative-summary">{summary}</p>}

      <div className="initiative-tabs" role="tablist" aria-label="Contenido de la iniciativa">
        <button aria-controls="initiative-details" aria-selected={tab === 'details'} id="details-tab" onClick={() => setTab('details')} onKeyDown={(event) => event.key === 'ArrowRight' && moveTab('result')} role="tab" tabIndex={tab === 'details' ? 0 : -1}>Detalles</button>
        <button aria-controls="initiative-result" aria-selected={tab === 'result'} id="result-tab" onClick={() => setTab('result')} onKeyDown={(event) => event.key === 'ArrowLeft' && moveTab('details')} role="tab" tabIndex={tab === 'result' ? 0 : -1}>Resultado</button>
      </div>

      {tab === 'details' ? (
        <section aria-labelledby="details-tab" className="initiative-details" id="initiative-details" role="tabpanel">
          <dl>
            <div><dt>Tipo</dt><dd>{initiative.type}</dd></div>
            <div><dt>Estado</dt><dd>{initiative.current_stage || 'Sin detalle publicado'}</dd></div>
            {initiative.official_result && <div><dt>Resultado oficial</dt><dd>{initiative.official_result}</dd></div>}
          </dl>
          {documents.length > 0 && (
            <div className="official-documents">
              <h2>Documentos oficiales</h2>
              {documents.map((document) => <a href={document.url} key={document.url}>{document.kind}</a>)}
            </div>
          )}
          <a className="official-source" href={initiative.official_url}>Ver expediente en el Congreso</a>
        </section>
      ) : (
        <section aria-labelledby="result-tab" className="initiative-result" id="initiative-result" role="tabpanel">
          {latestVote ? (
            <>
              <p className="vote-date">Última votación · {formatDate(latestVote.voted_on)}</p>
              <h2>{latestVote.subgroup_title || latestVote.title}</h2>
              <VoteHemicycle vote={latestVote} />
              <VoteTotals vote={latestVote} />
              <GroupVoteTable groups={latestVote.groups} />
              <a className="official-source" href={latestVote.source_url}>Ver votación en el Congreso</a>
            </>
          ) : <p>No hay una votación nominal vinculada a esta iniciativa.</p>}
        </section>
      )}
    </main>
  )
}
