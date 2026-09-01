import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { DeputiesPage } from './pages/DeputiesPage'
import { InitiativesPage } from './pages/InitiativesPage'
import { InitiativeDetailPage } from './pages/InitiativeDetailPage'
import { PartiesPage } from './pages/PartiesPage'
import './styles.css'

function Layout() {
  return (
    <>
      <header className="site-header">
        <nav aria-label="Principal">
          <Link className="brand" to="/">Parlamento</Link>
          <div className="nav-links">
            <Link activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }} to="/">Inicio</Link>
            <Link activeProps={{ 'aria-current': 'page' }} to="/deputies">Diputados</Link>
            <Link activeProps={{ 'aria-current': 'page' }} to="/parties">Partidos</Link>
          </div>
          <details className="mobile-nav">
            <summary aria-label="Abrir navegación">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </summary>
            <div>
              <Link activeOptions={{ exact: true }} activeProps={{ 'aria-current': 'page' }} to="/">Inicio</Link>
              <Link activeProps={{ 'aria-current': 'page' }} to="/deputies">Diputados</Link>
              <Link activeProps={{ 'aria-current': 'page' }} to="/parties">Partidos</Link>
            </div>
          </details>
        </nav>
      </header>
      <Outlet />
    </>
  )
}

const rootRoute = createRootRoute({ component: Layout })
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: InitiativesPage })
const deputiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deputies', component: DeputiesPage })
const partiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/parties', component: PartiesPage })
const initiativeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/iniciativas/$slug',
  component: function InitiativeRoute() {
    const { slug } = initiativeRoute.useParams()
    return <InitiativeDetailPage slug={slug} />
  },
})
const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, deputiesRoute, partiesRoute, initiativeRoute]) })

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
