import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  journey: <><circle cx="5" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 6h6a4 4 0 0 1 0 8h-2a4 4 0 0 0 0 4h6" /></>,
  checklist: <><path d="m4 6 2 2 3-3M4 14l2 2 3-3" /><path d="M13 7h7M13 15h7" /></>,
  bundle: <><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  deploy: <><path d="M12 3v12m0-12 4 4m-4-4L8 7" /><path d="M5 15v4h14v-4" /></>,
  connect: <><path d="M5 5h6v6H5zM13 13h6v6h-6z" /><path d="M11 8h3a2 2 0 0 1 2 2v3" /></>,
  migration: <><path d="M4 7h12m0 0-3-3m3 3-3 3M20 17H8m0 0 3-3m-3 3 3 3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  flow: <><rect x="3" y="3" width="6" height="6" rx="2" /><rect x="15" y="15" width="6" height="6" rx="2" /><path d="M9 6h3a3 3 0 0 1 3 3v6" /></>,
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  )
}
