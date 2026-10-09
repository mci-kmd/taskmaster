import { readThemeColor } from './theme'

/**
 * Theme colors for canvases that need concrete values (xterm, Monaco). Tokens may be any CSS
 * color (hex, rgb(), color-mix(), transparent); a 1×1 canvas resolves them to sRGB bytes, so the
 * result is always `#rrggbb` or `#rrggbbaa`.
 */
export type Rgba = readonly [red: number, green: number, blue: number, alpha: number]

const TRANSPARENT: Rgba = [0, 0, 0, 0]
let context: CanvasRenderingContext2D | null | undefined

function getContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context
  // jsdom has no canvas and reports every attempt as an error.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    context = null
    return context
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    context = canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    context = null
  }
  return context
}

/** Resolves a CSS color to sRGB bytes; null when it can't be resolved (no canvas, e.g. tests). */
export function parseColor(color: string): Rgba | null {
  const value = color.trim()
  if (!value) return null
  const ctx = getContext()
  if (!ctx) return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = 'transparent'
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data
  return [red, green, blue, alpha / 255]
}

/** Mixes `amount` (0–1) of `top` into `base`, in sRGB. */
export function mixColors(top: Rgba, base: Rgba, amount: number): Rgba {
  const channel = (index: number): number => top[index] * amount + base[index] * (1 - amount)
  return [channel(0), channel(1), channel(2), channel(3)]
}

/** The same color at another opacity. */
export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha]
}

export function toHex(color: Rgba): string {
  const byte = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  const alpha = color[3] >= 1 ? '' : byte(color[3] * 255)
  return `#${byte(color[0])}${byte(color[1])}${byte(color[2])}${alpha}`
}

/** Reads a theme token (e.g. `--color-panel`) as bytes; transparent when unavailable. */
export function readThemeRgba(token: string, element?: Element): Rgba {
  return parseColor(readThemeColor(token, element)) ?? TRANSPARENT
}

/** Whether theme colors can be resolved here (false without a canvas, e.g. in tests). */
export function canResolveColors(): boolean {
  return getContext() !== null
}
