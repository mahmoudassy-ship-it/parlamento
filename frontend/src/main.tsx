import React from 'react'
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

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <h1>Hey, this is Mahmoud's website</h1>,
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
