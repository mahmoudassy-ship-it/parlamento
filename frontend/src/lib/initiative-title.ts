function sentence(value: string) {
  const trimmed = value.replace(/[.\s]+$/, '').trim()
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : value
}

export function conciseInitiativeTitle(title: string) {
  const purpose = title.match(/(?:,|\))\s+para\s+(.+)$/i)?.[1]
  if (purpose && purpose.length >= 20 && !/^adaptar(?:la|lo|las|los)\b/i.test(purpose)) return sentence(purpose)

  const withoutForm = title.replace(
    /^(?:Proyecto|Proposición|Propuesta) de Ley(?: Orgánica)?\s+(?:por la que se |de )?/i,
    '',
  )
  return sentence(/^del\s/i.test(withoutForm) ? `Ley ${withoutForm}` : withoutForm)
}
