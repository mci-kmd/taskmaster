// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOTION, usePresence } from '../../lib/motion'
import Presence from './Presence'

/** A portalled popover that is meant to be open. */
function Popover(): React.JSX.Element | null {
  const { mounted, state } = usePresence(true)
  return mounted ? createPortal(<div data-state={state}>menu</div>, document.body) : null
}

describe('Presence', () => {
  const { animate } = Element.prototype

  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.animate = vi.fn() as never
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(() => {
    cleanup()
    Element.prototype.animate = animate
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps leaving content inert, closes what it opened, then unmounts it', () => {
    const view = (show: boolean): React.JSX.Element => (
      <Presence motion="fade" show={show}>
        <div data-testid="panel">
          <Popover />
        </div>
      </Presence>
    )
    const { rerender } = render(view(true))
    expect(screen.getByText('menu').dataset.state).toBe('open')

    rerender(view(false))
    const panel = screen.getByTestId('panel')
    expect(panel.dataset.state).toBe('closed')
    expect(panel.hasAttribute('inert')).toBe(true)
    // React context reaches through the portal, so the popover leaves with its owner.
    expect(screen.getByText('menu').dataset.state).toBe('closed')

    act(() => vi.advanceTimersByTime(MOTION.exitMs + 40))
    expect(screen.queryByTestId('panel')).toBeNull()
    expect(screen.queryByText('menu')).toBeNull()
  })
})
