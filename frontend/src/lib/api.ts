import { useEffect, useState } from 'react'

export type Deputy = {
  id: number
  name: string
  party: string
  parliamentary_group: string
  image_url: string | null
  image_page_url: string | null
  license_name: string | null
  license_url: string | null
  attribution: string | null
}

export type Party = {
  id: number
  code: string
  name: string | null
  seats: number
  share: number
}

export type Initiative = {
  expediente: string
  type: string
  title: string
  description: string | null
  author: string | null
  presented_on: string | null
  status: 'approved' | 'rejected' | 'withdrawn' | 'lapsed' | 'merged' | 'closed' | 'pending'
  official_result: string | null
  current_stage: string | null
  official_url: string
  plain_title: string | null
  plain_summary: string | null
  explanation_generated_at: string | null
  latest_vote: VotingEvent | null
}

export type VotePosition = 'yes' | 'no' | 'abstain' | 'not_voting' | 'mixed'

export type GroupVote = {
  code: string
  label: string
  yes_count: number
  no_count: number
  abstain_count: number
  not_voting_count: number
  position: VotePosition
}

export type VotingEvent = {
  id: number
  voted_on: string
  title: string
  initiative_text: string | null
  subgroup_title: string | null
  vote_text: string | null
  yes_count: number
  no_count: number
  abstain_count: number
  not_voting_count: number
  source_url: string
  groups: GroupVote[]
}

export type InitiativeDetail = {
  initiative: Initiative
  documents: { kind: string; url: string }[]
  votes: VotingEvent[]
}

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Request failed')
        return response.json()
      })
      .then(setData)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [url])

  return { data, error }
}
