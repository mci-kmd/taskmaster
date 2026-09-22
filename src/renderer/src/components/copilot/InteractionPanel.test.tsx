// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InteractionPanel from './InteractionPanel'
import SessionMarkdown from './SessionMarkdown'

afterEach(cleanup)
it('validates required choices, accepts decimals, and submits unchecked booleans explicitly', () => {
  const onRespond = vi.fn()
  render(
    <InteractionPanel
      threadId="thread"
      busy={false}
      onRespond={onRespond}
      interaction={{
        id: 'form',
        kind: 'elicitation',
        title: 'Details',
        description: 'Please fill this in',
        mode: 'form',
        schema: {
          required: ['choice', 'enabled', 'amount'],
          properties: {
            choice: { type: 'string', options: ['A', 'B'] },
            enabled: { type: 'boolean' },
            amount: { type: 'number' },
            optional: { type: 'integer', default: 10 }
          }
        }
      }}
    />
  )
  const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!
  expect(form.checkValidity()).toBe(false)
  fireEvent.click(screen.getByRole('combobox', { name: 'choice' }))
  fireEvent.click(screen.getByRole('option', { name: 'B' }))
  fireEvent.change(screen.getByLabelText('amount'), { target: { value: '2.5' } })
  fireEvent.change(screen.getByLabelText('optional'), { target: { value: '' } })
  expect(form.checkValidity()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onRespond).toHaveBeenCalledWith({
    threadId: 'thread',
    interactionId: 'form',
    action: 'accept',
    values: { choice: 'B', enabled: false, amount: 2.5 }
  })
})
it('renders readable markdown and code without enabling unsafe links or remote images', () => {
  const { container } = render(
    <SessionMarkdown>
      {
        '## Summary\n\n- **Done**\n\n```ts\nconst value = 1\n```\n\n[Docs](https://example.com) [Unsafe](javascript:alert(1))\n\n![Remote](https://example.com/tracker.png)'
      }
    </SessionMarkdown>
  )
  expect(screen.getByRole('heading', { name: 'Summary' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('target')).toBe('_blank')
  expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull()
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
})
it('offers cancellation for questions with fixed choices', () => {
  const onRespond = vi.fn()
  render(
    <InteractionPanel
      threadId="thread"
      busy={false}
      onRespond={onRespond}
      interaction={{
        id: 'question',
        kind: 'user-input',
        title: 'Plan ready',
        description: 'Proceed?',
        choices: ['Implement'],
        allowFreeform: false
      }}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onRespond).toHaveBeenCalledWith({
    threadId: 'thread',
    interactionId: 'question',
    action: 'cancel'
  })
})
