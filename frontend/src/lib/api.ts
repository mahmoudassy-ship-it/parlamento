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
