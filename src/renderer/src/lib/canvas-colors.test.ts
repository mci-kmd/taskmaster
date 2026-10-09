import { describe, expect, it } from 'vitest'
import { mixColors, toHex, withAlpha, type Rgba } from './canvas-colors'

describe('canvas colors', () => {
  const blue: Rgba = [47, 91, 234, 1]
  const white: Rgba = [255, 255, 255, 1]

  it('writes opaque colors as #rrggbb and translucent ones as #rrggbbaa', () => {
    expect(toHex(blue)).toBe('#2f5bea')
    expect(toHex(withAlpha(blue, 0.2))).toBe('#2f5bea33')
    expect(toHex([0, 0, 0, 0])).toBe('#00000000')
  })

  it('mixes in sRGB and clamps channels', () => {
    expect(toHex(mixColors(blue, white, 0))).toBe('#ffffff')
    expect(toHex(mixColors(blue, white, 1))).toBe('#2f5bea')
    expect(toHex(mixColors(blue, white, 0.5))).toBe('#97adf5')
    expect(toHex([300, -4, 12.6, 1])).toBe('#ff000d')
  })
})
