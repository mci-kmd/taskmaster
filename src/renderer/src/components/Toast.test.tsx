// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Toast from './Toast'

describe('Toast', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('auto-dismisses success toasts', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(<Toast tone="success" message="Saved." onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(3500)
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps error toasts visible until dismissed manually', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(<Toast tone="error" message="Save failed." onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
