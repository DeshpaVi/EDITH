import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * A blank panel is the worst thing this app can do to an agent mid-call: it
 * says nothing about whether the data is missing, the app is broken, or they
 * are looking at the wrong tab. React unmounts the whole tree when a render or
 * effect throws, so without this boundary any single failure produces exactly
 * that — white space and no explanation.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The workspace swallows uncaught errors, so this is the only place the
    // stack reaches anywhere a developer can read it.
    console.error('Contact handoff failed to render', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="app">
        <header className="header">
          <h1 className="header__title">Contact handoff</h1>
          <span className="header__meta">stopped</span>
        </header>
        <div className="notice" data-tone="bad" role="alert">
          <div className="notice__body">
            <div className="notice__title">The app hit an error and stopped</div>
            <p>
              Attribute and transcript data are unaffected — this is a fault in the panel itself.
              Reopening the app from the Apps menu usually clears it.
            </p>
            <p className="attr__value--mono">{error.message}</p>
          </div>
        </div>
      </div>
    )
  }
}
