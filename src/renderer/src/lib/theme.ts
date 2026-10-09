import { useSyncExternalStore } from 'react'
import {
  DEFAULT_THEME,
  getTheme,
  isThemeId,
  type Theme,
  type ThemeId
} from '../../../shared/themes'
import { canAnimate } from './motion'

/** Remembers the theme between launches so the first paint already uses it. */
const STORAGE_KEY = 'taskmaster:theme'

const listeners = new Set<() => void>()
let current: ThemeId = readStoredTheme()

function readStoredTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isThemeId(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Applies the stored theme before React renders. */
export function initializeTheme(): void {
  document.documentElement.dataset.theme = current
}

/** Switches the app's theme, crossfading the window unless `animate` is false. */
export function setTheme(id: ThemeId, { animate = true }: { animate?: boolean } = {}): void {
  if (id === current && document.documentElement.dataset.theme === id) return
  current = id
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage is only a first-paint optimization.
  }
  const apply = (): void => {
    document.documentElement.dataset.theme = id
    listeners.forEach((listener) => listener())
  }
  if (animate && canAnimate() && typeof document.startViewTransition === 'function') {
    document.startViewTransition(apply)
  } else {
    apply()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The active theme; components re-render when it changes. */
export function useTheme(): Theme {
  return getTheme(useSyncExternalStore(subscribe, () => current))
}

/**
 * Resolves theme tokens to concrete colors for canvases that can't read CSS variables
 * (xterm, Monaco). Read after the theme is applied, e.g. in an effect keyed on useTheme().
 */
export function readThemeColor(token: string, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(token).trim()
}
