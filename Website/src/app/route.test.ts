import { describe, expect, it } from 'vitest'
import { PAGES } from './pages'
import { hrefFor, parseRoute } from './route'

describe('parseRoute', () => {
  it('treats the empty hash and in-page anchors as the landing page', () => {
    for (const h of ['', '#', '#/', '#platform', '#how-it-works', '#top']) expect(parseRoute(h)).toEqual({ view: 'landing' })
  })
  it('opens the overview at #/app and an unknown page falls back to it', () => {
    expect(parseRoute('#/app')).toEqual({ view: 'app', page: 'overview' })
    expect(parseRoute('#/app/')).toEqual({ view: 'app', page: 'overview' })
    expect(parseRoute('#/app/nope')).toEqual({ view: 'app', page: 'overview' })
  })
  it('round-trips every page', () => {
    for (const p of PAGES) expect(parseRoute(hrefFor(p.id))).toEqual({ view: 'app', page: p.id })
  })
  it('does not treat a look-alike prefix as the workspace', () => {
    expect(parseRoute('#/application')).toEqual({ view: 'landing' })
    expect(parseRoute('#/app/journey/extra')).toEqual({ view: 'landing' })
  })
})
