import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import './styles.css'

const rootRoute = createRootRoute({ component: Outlet })

type Deputy = {
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

function DeputyList() {
  const [deputies, setDeputies] = useState<Deputy[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/deputies')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load deputies')
        return response.json()
      })
      .then(setDeputies)
      .catch(() => setError(true))
  }, [])

  if (error) return <p role="alert">Unable to load deputies.</p>
  if (!deputies.length) return <p>Loading…</p>

  return (
    <main className="deputies">
      {deputies.map((deputy) => {
        const photoTitle = [deputy.attribution, deputy.license_name].filter(Boolean).join(' · ')

        return (
          <article className="deputy" key={deputy.id}>
            <div className="photo">
              <span aria-hidden="true">{initials(deputy.name)}</span>
              {deputy.image_url && deputy.image_page_url && (
                <a href={deputy.image_page_url} aria-label={`Photo source for ${displayName(deputy.name)}`}>
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

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DeputyList,
})

const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
