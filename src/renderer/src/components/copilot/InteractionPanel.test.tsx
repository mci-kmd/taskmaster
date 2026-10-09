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
  fireEvent.click(screen.getByRole('radio', { name: 'B' }))
  expect(screen.queryByRole('textbox', { name: 'choice: your own answer' })).toBeNull()
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
it('renders boolean fields as a labelled checkbox with its description', () => {
  const onRespond = vi.fn()
  render(
    <InteractionPanel
      threadId="thread"
      busy={false}
      onRespond={onRespond}
      interaction={{
        id: 'form',
        kind: 'elicitation',
        title: 'Copilot needs more information',
        description: 'Exclude null placeholders?',
        mode: 'form',
        schema: {
          required: ['strict'],
          properties: {
            strict: {
              type: 'boolean',
              title: 'Require [Required]',
              description: 'For null-initialized properties',
              default: true
            }
          }
        }
      }}
    />
  )
  const checkbox = screen.getByRole('checkbox', {
    name: /Require \[Required\]/
  }) as HTMLInputElement
  expect(checkbox.checked).toBe(true)
  expect(screen.getByText('For null-initialized properties')).toBeTruthy()
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onRespond).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'accept', values: { strict: false } })
  )
})
it('lets the user answer Copilot choice questions in their own words', () => {
  const onRespond = vi.fn()
  render(
    <InteractionPanel
      threadId="thread"
      busy={false}
      onRespond={onRespond}
      interaction={{
        id: 'form',
        kind: 'elicitation',
        title: 'Copilot needs more information',
        description: 'How should we proceed?',
        mode: 'form',
        allowFreeform: true,
        schema: {
          required: ['approach', 'targets'],
          properties: {
            approach: { type: 'string', title: 'Approach', options: ['Fast', 'Safe'] },
            targets: { type: 'array', title: 'Targets', options: ['web', 'desktop'] }
          }
        }
      }}
    />
  )
  const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!
  expect(screen.getByRole('radiogroup', { name: 'Approach' })).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: 'Fast' }))
  const approachOther = screen.getByRole('textbox', { name: 'Approach: your own answer' })
  fireEvent.focus(approachOther)
  expect((screen.getByRole('radio', { name: 'Other' }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('radio', { name: 'Fast' }) as HTMLInputElement).checked).toBe(false)
  expect(form.checkValidity()).toBe(false)
  fireEvent.change(approachOther, { target: { value: '  Ship behind a flag  ' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'web' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Targets: your own answer' }), {
    target: { value: 'cli' }
  })
  expect(form.checkValidity()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onRespond).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'accept',
      values: { approach: 'Ship behind a flag', targets: ['web', 'cli'] }
    })
  )
})
it('requires a multi-select answer when the field is required', () => {
  render(
    <InteractionPanel
      threadId="thread"
      busy={false}
      onRespond={vi.fn()}
      interaction={{
        id: 'form',
        kind: 'elicitation',
        title: 'Server request',
        description: 'Pick targets',
        mode: 'form',
        schema: {
          required: ['targets'],
          properties: { targets: { type: 'array', options: ['web', 'desktop'] } }
        }
      }}
    />
  )
  const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!
  expect(screen.queryByRole('checkbox', { name: 'Other' })).toBeNull()
  expect(form.checkValidity()).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: 'desktop' }))
  expect(form.checkValidity()).toBe(true)
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
