import type { PreviewRect } from '../../shared/app-types'

export const CAPTURE_PADDING_CSS_PX = 24
export const CAPTURE_MAX_DIMENSION_PX = 1600

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * Maps an element's CSS-pixel rect onto a captured viewport image, adding a little surrounding
 * context. Returns null when the element is not visible in the capture.
 */
export function cropRectForElement(
  rect: PreviewRect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
  padding = CAPTURE_PADDING_CSS_PX
): PreviewRect | null {
  if (
    ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(finite) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  )
    return null
  const scaleX = image.width / viewport.width
  const scaleY = image.height / viewport.height
  const left = Math.max(0, Math.floor((rect.x - padding) * scaleX))
  const top = Math.max(0, Math.floor((rect.y - padding) * scaleY))
  const right = Math.min(image.width, Math.ceil((rect.x + rect.width + padding) * scaleX))
  const bottom = Math.min(image.height, Math.ceil((rect.y + rect.height + padding) * scaleY))
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function fitWithin(
  size: { width: number; height: number },
  max: number
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(size.width, size.height))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}
