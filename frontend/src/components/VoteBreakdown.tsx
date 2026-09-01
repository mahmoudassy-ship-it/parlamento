import { type GroupVote, type VotePosition, type VotingEvent } from '../lib/api'

const choiceLabels: Record<VotePosition, string> = {
  yes: 'Sí',
  no: 'No',
  abstain: 'Abst.',
  not_voting: 'No vota',
  mixed: 'Dividido',
}

const choiceColors: Record<Exclude<VotePosition, 'mixed'>, string> = {
  yes: '#3f9850',
  no: '#b93643',
  abstain: '#c48312',
  not_voting: '#c5c5c5',
}

function seatPositions(total: number) {
  const rows = 10
  const radii = Array.from({ length: rows }, (_, index) => 112 + index * 17)
  const radiusTotal = radii.reduce((sum, radius) => sum + radius, 0)
  const exactCounts = radii.map((radius) => (radius / radiusTotal) * total)
  const counts = exactCounts.map(Math.floor)
  let remaining = total - counts.reduce((sum, count) => sum + count, 0)

  exactCounts
    .map((count, index) => ({ index, remainder: count - Math.floor(count) }))
    .sort((a, b) => b.remainder - a.remainder)
    .forEach(({ index }) => {
      if (remaining > 0) {
        counts[index] += 1
        remaining -= 1
      }
    })

  return radii.flatMap((radius, row) =>
    Array.from({ length: counts[row] }, (_, index) => {
      const angle = Math.PI + (Math.PI * index) / (counts[row] - 1)
      return { x: 320 + radius * Math.cos(angle), y: 292 + radius * Math.sin(angle), angle, radius }
    }),
  ).sort((a, b) => a.angle - b.angle || a.radius - b.radius)
}

export function CompactGroupVotes({ groups }: { groups: GroupVote[] }) {
  return (
    <div className="compact-votes" aria-label="Posición de los principales grupos en la última votación">
      <p>Última votación</p>
      <div>
        {groups.map((group) => (
          <span className={`compact-vote choice-${group.position}`} key={group.code}>
            <strong>{group.label}</strong>
            <span>{choiceLabels[group.position]}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function VoteHemicycle({ vote }: { vote: VotingEvent }) {
  const choices = (Object.keys(choiceColors) as Array<keyof typeof choiceColors>).flatMap((choice) =>
    Array.from({ length: vote[`${choice}_count`] }, () => choice),
  )
  const positions = seatPositions(choices.length)

  return (
    <svg className="vote-hemicycle" viewBox="0 0 640 315" role="img" aria-label={`Resultado: ${vote.yes_count} sí, ${vote.no_count} no, ${vote.abstain_count} abstenciones y ${vote.not_voting_count} no votan`}>
      {positions.map((position, index) => (
        <circle key={index} cx={position.x} cy={position.y} r="5.5" fill={choiceColors[choices[index]]} />
      ))}
    </svg>
  )
}

export function VoteTotals({ vote }: { vote: VotingEvent }) {
  const totals = [
    ['yes', 'Sí', vote.yes_count],
    ['no', 'No', vote.no_count],
    ['abstain', 'Abst.', vote.abstain_count],
    ['not_voting', 'No votan', vote.not_voting_count],
  ] as const

  return (
    <div className="vote-totals">
      {totals.map(([choice, label, count]) => (
        <div className={`choice-${choice}`} key={choice}>
          <span>{label}</span>
          <strong>{count}</strong>
        </div>
      ))}
    </div>
  )
}

export function GroupVoteTable({ groups }: { groups: GroupVote[] }) {
  return (
    <div className="group-vote-table">
      {groups.map((group) => (
        <div className="group-vote-row" key={group.code}>
          <strong>{group.label}</strong>
          <span className="choice-yes"><b>Sí</b>{group.yes_count}</span>
          <span className="choice-no"><b>No</b>{group.no_count}</span>
          <span className="choice-abstain"><b>Abst.</b>{group.abstain_count}</span>
          <span className="choice-not_voting"><b>No votan</b>{group.not_voting_count}</span>
        </div>
      ))}
    </div>
  )
}
