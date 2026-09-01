import { type Deputy, useApi } from '../lib/api'

function displayName(name: string) {
  return name.includes(',') ? name.split(',').reverse().map((part) => part.trim()).join(' ') : name
}

function initials(name: string) {
  return displayName(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
}

export function DeputiesPage() {
  const { data: deputies, error } = useApi<Deputy[]>('/api/deputies')

  if (error) return <main className="page"><p role="alert">No se pudieron cargar los diputados.</p></main>
  if (!deputies) return <main className="page"><p>Cargando…</p></main>

  return (
    <main className="page deputies">
      <h1 className="visually-hidden">Diputados</h1>
      {deputies.map((deputy) => {
        const photoTitle = [deputy.attribution, deputy.license_name].filter(Boolean).join(' · ')

        return (
          <article className="deputy" key={deputy.id}>
            <div className="photo">
              <span aria-hidden="true">{initials(deputy.name)}</span>
              {deputy.image_url && deputy.image_page_url && (
                <a href={deputy.image_page_url} aria-label={`Fuente de la foto de ${displayName(deputy.name)}`}>
                  <img src={deputy.image_url} alt="" loading="lazy" title={photoTitle} />
                </a>
              )}
            </div>
            <div className="details">
              <h2>{displayName(deputy.name)}</h2>
              <p>{deputy.party}</p>
              <p>{deputy.parliamentary_group}</p>
            </div>
          </article>
        )
      })}
    </main>
  )
}
