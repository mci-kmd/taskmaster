import { describe, expect, it } from 'vitest'
import { cropRectForElement, fitWithin } from './preview-capture'

describe('preview capture geometry', () => {
  it('scales CSS pixels to the captured image and pads the element', () => {
    expect(
      cropRectForElement(
        { x: 40, y: 100, width: 120, height: 40 },
        { width: 800, height: 600 },
        { width: 1200, height: 900 },
        10
      )
    ).toEqual({ x: 45, y: 135, width: 210, height: 90 })
  })

  it('clamps to the image and rejects elements outside the viewport', () => {
    const viewport = { width: 800, height: 600 }
    const image = { width: 800, height: 600 }
    expect(
      cropRectForElement({ x: -50, y: 580, width: 100, height: 100 }, viewport, image)
    ).toEqual({ x: 0, y: 556, width: 74, height: 44 })
    expect(cropRectForElement({ x: 0, y: 700, width: 10, height: 10 }, viewport, image)).toBeNull()
    expect(
      cropRectForElement({ x: 0, y: 0, width: 10, height: 10 }, viewport, { width: 0, height: 0 })
    ).toBeNull()
    expect(
      cropRectForElement({ x: Number.NaN, y: 0, width: 10, height: 10 }, viewport, image)
    ).toBeNull()
  })

  it('fits large captures without upscaling small ones', () => {
    expect(fitWithin({ width: 3200, height: 800 }, 1600)).toEqual({ width: 1600, height: 400 })
    expect(fitWithin({ width: 300, height: 200 }, 1600)).toEqual({ width: 300, height: 200 })
  })
})
