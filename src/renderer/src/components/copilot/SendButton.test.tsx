// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SendButton from './SendButton'

afterEach(cleanup)

const toggleName = 'Choose how to send while Copilot works'

it('queues without offering a choice when steering is unavailable', () => {
  const onSend = vi.fn()
  render(
    <SendButton
      running
      canSteer={false}
      delivery="steer"
      disabled={false}
      onDeliveryChange={vi.fn()}
      onSend={onSend}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Queue' }))
  expect(onSend).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: toggleName })).toBeNull()
  expect(document.querySelector('.tm-send')?.getAttribute('data-split')).toBe('false')
})

it('keeps the mode menu usable while the message is empty and supports the keyboard', () => {
  const onDeliveryChange = vi.fn()
  render(
    <SendButton
      running
      delivery="steer"
      disabled
      onDeliveryChange={onDeliveryChange}
      onSend={vi.fn()}
    />
  )
  expect((screen.getByRole('button', { name: 'Steer' }) as HTMLButtonElement).disabled).toBe(true)
  const toggle = screen.getByRole('button', { name: toggleName })
  fireEvent.keyDown(toggle, { key: 'ArrowDown' })
  const steer = screen.getByRole('menuitemradio', { name: /Steer/ })
  expect(document.activeElement).toBe(steer)
  fireEvent.keyDown(steer, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Queue/ }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(toggle)
  expect(onDeliveryChange).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Queue/ }))
  expect(onDeliveryChange).toHaveBeenCalledExactlyOnceWith('queue')
})

it('stays open while the conversation scrolls and closes for good when the turn ends', () => {
  const props = {
    delivery: 'steer' as const,
    disabled: false,
    onDeliveryChange: vi.fn(),
    onSend: vi.fn()
  }
  const { rerender } = render(<SendButton running {...props} />)
  fireEvent.click(screen.getByRole('button', { name: toggleName }))
  fireEvent.scroll(document.body)
  expect(screen.getByRole('menu')).toBeTruthy()
  rerender(<SendButton running={false} {...props} />)
  expect(screen.queryByRole('menu')).toBeNull()
  rerender(<SendButton running {...props} />)
  expect(screen.queryByRole('menu')).toBeNull()
})
