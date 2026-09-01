import { type Party, useApi } from '../lib/api'

const partyColors: Record<string, string> = {
  PP: '#2767b2',
  PSOE: '#d9272e',
  'PSC-PSOE': '#d9272e',
  'PsdeG-PSOE': '#d9272e',
  'PSE-EE (PSOE)': '#d9272e',
  'PSIB-PSOE': '#d9272e',
  'PSN-PSOE': '#d9272e',
  VOX: '#4b8b3b',
  SUMAR: '#d44b86',
  ERC: '#e0a400',
  'JxCAT-JUNTS': '#21a6a1',
  'EH Bildu': '#5b8c45',
  'EAJ-PNV': '#397d52',
  BNG: '#6aa7aa',
  CCa: '#e0bc32',
  UPN: '#315888',
}

function seatPositions(total: number) {
  const rows = 10
  const radii = Array.from({ length: rows }, (_, index) => 112 + index * 17)
  const radiusTotal = radii.reduce((sum, radius) => sum + radius, 0)
  const exactCounts = radii.map((radius) => (radius / radiusTotal) * total)
  const counts = exactCounts.map(Math.floor)
  const remaining = total - counts.reduce((sum, count) => sum + count, 0)
  exactCounts
    .map((count, index) => ({ index, remainder: count - Math.floor(count) }))
    .sort((a, b) => b.remainder - a.remainder)
    .slice(0, remaining)
    .forEach(({ index }) => { counts[index] += 1 })

  return radii.flatMap((radius, row) =>
    Array.from({ length: counts[row] }, (_, index) => {
      const angle = Math.PI + (Math.PI * index) / (counts[row] - 1)
      return {
        x: 320 + radius * Math.cos(angle),
        y: 292 + radius * Math.sin(angle),
        angle,
        radius,
      }
    }),
  ).sort((a, b) => a.angle - b.angle || a.radius - b.radius)
}

function Hemicycle({ parties }: { parties: Party[] }) {
  const seats = parties.flatMap((party) => Array.from({ length: party.seats }, () => party.code))
  const positions = seatPositions(seats.length)

  return (
    <svg className="hemicycle" viewBox="0 0 640 315" role="img" aria-label={`Distribución de ${seats.length} escaños por partido`}>
      {positions.map((position, index) => (
        <circle
          key={index}
          cx={position.x}
          cy={position.y}
          r="5.5"
          fill={partyColors[seats[index]] || '#777'}
        />
      ))}
    </svg>
  )
}

export function PartiesPage() {
  const { data: parties, error } = useApi<Party[]>('/api/parties')

  if (error) return <main className="page"><p role="alert">No se pudieron cargar los partidos.</p></main>
  if (!parties) return <main className="page"><p>Cargando…</p></main>

  const total = parties.reduce((sum, party) => sum + party.seats, 0)

  return (
    <main className="page parties-page">
      <h1 className="visually-hidden">Partidos</h1>
      <Hemicycle parties={parties} />
      <p className="seat-total">Congreso · {total} escaños</p>
      <div className="party-list">
        {parties.map((party) => (
          <article className="party-row" key={party.id}>
            <span className="party-color" style={{ backgroundColor: partyColors[party.code] || '#777' }} aria-hidden="true" />
            <h2>{party.code}</h2>
            <strong>{party.seats}</strong>
            <span>{party.share.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>
          </article>
        ))}
      </div>
    </main>
  )
}
