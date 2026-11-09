export type ThemeName = 'dark' | 'light'

const KEY = 'edith.theme'

/** Stored choice, else the OS preference. Storage can be blocked, so every access is guarded. */
export function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* storage unavailable */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* storage unavailable */ }
}
