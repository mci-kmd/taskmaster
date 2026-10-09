// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTheme, useTheme } from './theme'

describe('setTheme', () => {
  const { animate } = Element.prototype
  const { startViewTransition } = document

  afterEach(() => {
    Element.prototype.animate = animate
    document.startViewTransition = startViewTransition
    vi.unstubAllGlobals()
    setTheme('graphite', { animate: false })
  })

  it('reports the new theme only once its stylesheet applies', () => {
    // Make animations available and hold the view transition until we run its callback.
    Element.prototype.animate = vi.fn() as never
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    let runTransition: () => void = () => {}
    document.startViewTransition = vi.fn((callback: () => void) => {
      runTransition = callback
    }) as never
    const { result } = renderHook(() => useTheme())

    act(() => setTheme('porcelain'))
    expect(result.current.id).toBe('graphite')
    expect(document.documentElement.dataset.theme).not.toBe('porcelain')

    act(() => runTransition())
    expect(result.current.id).toBe('porcelain')
    expect(document.documentElement.dataset.theme).toBe('porcelain')
  })

  it('lets the last request win while a crossfade is pending', () => {
    Element.prototype.animate = vi.fn() as never
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const transitions: Array<() => void> = []
    document.startViewTransition = vi.fn((callback: () => void) => {
      transitions.push(callback)
    }) as never
    const { result } = renderHook(() => useTheme())

    act(() => setTheme('porcelain'))
    act(() => setTheme('graphite'))
    act(() => transitions.forEach((run) => run()))

    expect(result.current.id).toBe('graphite')
    expect(document.documentElement.dataset.theme).toBe('graphite')
  })
})
