import { useEffect, useState } from 'react'
import { Pages } from './app/Pages'
import { Shell } from './app/Shell'
import { parseRoute } from './app/route'
import type { Route } from './app/route'
import { WorkspaceProvider } from './app/workspace'
import { Landing } from './site/Landing'
import './site/landing.css'

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/**
 * Landing page at "/" and the workspace at "#/app". The workspace provider sits above the router so a journey
 * survives a trip back to the landing page.
 */
export default function App() {
  const route = useRoute()
  useEffect(() => {
    if (route.view === 'landing') delete document.documentElement.dataset.theme
  }, [route.view])
  return (
    <WorkspaceProvider>
      {route.view === 'landing' ? <div className="lp"><Landing /></div> : <Shell page={route.page}><Pages page={route.page} /></Shell>}
    </WorkspaceProvider>
  )
}
