import { PAGES } from './pages'
import type { PageId } from './pages'

export type Route = { view: 'landing' } | { view: 'app'; page: PageId }

/**
 * Hash routes: "#/app" and "#/app/<page>" are the workspace; anything else (including in-page anchors such as
 * "#platform") is the landing page. A hash hosts the router because the site is static (S3/CloudFront) and needs no rewrite rules.
 */
export function parseRoute(hash: string): Route {
  const m = /^#\/app(?:\/([a-z-]+))?\/?$/.exec(hash)
  if (!m) return { view: 'landing' }
  const page = PAGES.find((p) => p.id === m[1])
  return { view: 'app', page: page ? page.id : 'overview' }
}

export const hrefFor = (page: PageId): string => (page === 'overview' ? '#/app' : `#/app/${page}`)
