/**
 * The app's color themes. Token values live in the renderer's `styles/themes.css`; this registry
 * holds what other layers need without parsing CSS: labels for the picker, the native appearance
 * (scrollbars, context menus) and the window background shown before the renderer paints.
 */
export const THEMES = [
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Soft warm graphite with a floating workspace.',
    appearance: 'dark',
    background: '#232220'
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Cool blue-grey, with the sidebar and workspace as two cards.',
    appearance: 'dark',
    background: '#1f232a'
  },
  {
    id: 'mist',
    label: 'Mist',
    description: 'The softest dark: mid-grey haze, almost borderless.',
    appearance: 'dark',
    background: '#2c2e32'
  },
  {
    id: 'stone',
    label: 'Stone',
    description: 'Warm greige with a recessed workspace and a raised composer.',
    appearance: 'dark',
    background: '#312e2a'
  },
  {
    id: 'porcelain',
    label: 'Porcelain',
    description: 'Light: a floating porcelain card on warm paper.',
    appearance: 'light',
    background: '#f4f2ed'
  }
] as const satisfies readonly ThemeDefinition[]

type ThemeDefinition = {
  id: string
  label: string
  description: string
  appearance: 'dark' | 'light'
  background: string
}

export type ThemeId = (typeof THEMES)[number]['id']
export type Theme = (typeof THEMES)[number]

export const DEFAULT_THEME: ThemeId = 'graphite'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function getTheme(id: ThemeId | undefined): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}
