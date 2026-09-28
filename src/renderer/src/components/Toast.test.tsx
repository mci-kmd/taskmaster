// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Toast from './Toast'

describe('Toast', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('stays visible until dismissed manually', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(<Toast message="Save failed." onDismiss={onDismiss} />)

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
