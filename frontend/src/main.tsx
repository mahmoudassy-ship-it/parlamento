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
        </nav>
      </header>
      <Outlet />
    </>
  )
}

function HomePage() {
  return (
    <main className="page home-page">
      <h1>Votaciones</h1>
      <p>Próximamente.</p>
    </main>
  )
}

const rootRoute = createRootRoute({ component: Layout })
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const deputiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/deputies', component: DeputiesPage })
const partiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/parties', component: PartiesPage })
const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, deputiesRoute, partiesRoute]) })

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
