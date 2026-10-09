// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOTION } from './motion'
import { usePresenceList } from './use-presence-list'

type Item = { id: string }

describe('usePresenceList', () => {
  const { animate } = Element.prototype

  beforeEach(() => {
    vi.useFakeTimers()
    // Animations are available, so removed items stay mounted while they animate out.
    Element.prototype.animate = vi.fn() as never
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(() => {
    Element.prototype.animate = animate
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('removes an exiting item on time even while the items keep being rebuilt', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: Item[] }) => usePresenceList(items, (item) => item.id, ''),
      { initialProps: { items: [{ id: 'kept' }, { id: 'sent' }] } }
    )

    rerender({ items: [{ id: 'kept' }] })
    expect(result.current.map((entry) => entry.key)).toEqual(['kept', 'sent'])

    // Streaming snapshots deserialize fresh objects for the remaining item every 60ms.
    for (let elapsed = 0; elapsed < MOTION.exitMs + 100; elapsed += 60) {
      act(() => vi.advanceTimersByTime(60))
      rerender({ items: [{ id: 'kept' }] })
    }

    expect(result.current.map((entry) => entry.key)).toEqual(['kept'])
  })
})
