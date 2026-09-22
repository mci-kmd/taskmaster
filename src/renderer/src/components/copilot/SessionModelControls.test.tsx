// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CopilotModelOption, CopilotSessionSnapshot } from '../../../../shared/app-types'
import SessionModelControls from './SessionModelControls'

const model = (id: string, name: string): CopilotModelOption => ({
  id,
  name,
  supportsVision: true,
  supportedReasoningEfforts: ['low', 'high'],
  defaultReasoningEffort: 'high'
})
const models = [
  model('claude-sonnet-4.5', 'Claude Sonnet 4.5'),
  model('gpt-4.1', 'GPT-4.1'),
  model('gemini-2.5-pro', 'Gemini 2.5 Pro'),
  model('claude-haiku-4.5', 'Claude Haiku 4.5'),
  model('gpt-5-mini', 'GPT-5 mini'),
  model('new-model', 'Future model')
]
const session: CopilotSessionSnapshot = {
  threadId: 'thread',
  sessionId: 'session',
  title: null,
  phase: 'idle',
  model: 'gpt-5-mini',
  reasoningEffort: 'high',
  agentMode: 'interactive',
  models,
  timeline: [],
  pendingInteraction: null,
  error: null
}
afterEach(cleanup)

describe('model picker families', () => {
  it('groups an interleaved catalog, preserves within-family order, and keeps selection and reasoning defaults', () => {
    const onChange = vi.fn()
    render(
      <SessionModelControls
        session={session}
        disabled={false}
        busy={false}
        disabledReason=""
        onChange={onChange}
      />
    )
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    expect(trigger.textContent).toContain('GPT-5 mini')
    fireEvent.click(trigger)
    const list = screen.getByRole('listbox', { name: 'Model' })
    expect(within(list).getAllByRole('group')).toHaveLength(4)
    expect(
      within(screen.getByRole('group', { name: 'Claude' }))
        .getAllByRole('option')
        .map((option) => option.getAttribute('aria-label'))
    ).toEqual(['Claude Sonnet 4.5', 'Claude Haiku 4.5'])
    expect(
      within(screen.getByRole('group', { name: 'GPT' }))
        .getAllByRole('option')
        .map((option) => option.getAttribute('aria-label'))
    ).toEqual(['GPT-4.1', 'GPT-5 mini'])
    expect(screen.getByRole('option', { name: 'GPT-5 mini' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Gemini 2.5 Pro' }).id
    )
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('gemini-2.5-pro', 'high')
    expect(document.activeElement).toBe(trigger)
  })

  it('retains unknown models and a missing active model without inventing available models', () => {
    const onChange = vi.fn()
    render(
      <SessionModelControls
        session={{ ...session, model: 'retired', models: [models[5]] }}
        disabled={false}
        busy={false}
        disabledReason=""
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    const current = within(screen.getByRole('group', { name: 'Current model' })).getByRole(
      'option',
      { name: 'retired' }
    )
    expect(current.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(current)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Other models' })).getByRole('option', {
        name: 'Future model'
      })
    )
    expect(onChange).toHaveBeenCalledWith('new-model', 'high')
  })

  it('shows only the families actually available to the session', () => {
    render(
      <SessionModelControls
        session={{ ...session, models: [models[1]] }}
        disabled={false}
        busy={false}
        disabledReason=""
        onChange={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    expect(screen.queryByRole('group', { name: 'Claude' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Gemini' })).toBeNull()
    expect(screen.getByRole('group', { name: 'GPT' })).toBeTruthy()
  })
})
