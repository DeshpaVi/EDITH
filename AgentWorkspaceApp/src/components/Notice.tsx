import type { ReactNode } from 'react'

export type NoticeTone = 'info' | 'warn' | 'bad'

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: NoticeTone
  title?: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="notice" data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
      <div className="notice__body">
        {title ? <div className="notice__title">{title}</div> : null}
        {children}
      </div>
      {action}
    </div>
  )
}
