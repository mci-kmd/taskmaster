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
  nextModelSelection: null,
  agentMode: 'interactive',
  models,
  timeline: [],
  pendingInteraction: null,
  error: null
}
afterEach(cleanup)

describe('nested model families', () => {
  function renderPicker(current = session): ReturnType<typeof vi.fn> {
    const onChange = vi.fn()
    render(
      <SessionModelControls
        session={current}
        disabled={false}
        busy={false}
        disabledReason=""
        onChange={onChange}
      />
    )
    return onChange
  }

  it('shows only families initially and opens just the selected family’s models', () => {
    const onChange = renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    const tree = screen.getByRole('tree', { name: 'Model families' })
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Claude', 'GPT', 'Gemini', 'Other models'])
    expect(screen.queryByRole('treeitem', { name: 'Claude Sonnet 4.5' })).toBeNull()
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    expect(screen.queryByRole('button', { name: 'Back to model families' })).toBeNull()
    expect(screen.queryByText(/Supports images|Text only|Adjustable reasoning/)).toBeNull()
    expect(
      within(screen.getByRole('group', { name: 'Claude models' }))
        .getAllByRole('treeitem')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Claude Sonnet 4.5', 'Claude Haiku 4.5'])
    expect(screen.queryByRole('treeitem', { name: 'GPT-4.1' })).toBeNull()
    fireEvent.pointerMove(screen.getByRole('treeitem', { name: 'GPT' }))
    expect(screen.queryByRole('group', { name: 'Claude models' })).toBeNull()
    expect(screen.getByRole('treeitem', { name: 'GPT-5 mini' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('treeitem', { name: 'GPT-4.1' }))
    expect(onChange).toHaveBeenCalledWith('gpt-4.1', 'high')
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('uses Right/Left to enter and leave a family, and Enter to select a model', () => {
    const onChange = renderPicker()
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: 'GPT' }).id
    )
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: 'GPT-5 mini' }).id
    )
    fireEvent.keyDown(trigger, { key: 'ArrowLeft' })
    expect(screen.queryByRole('group', { name: 'GPT models' })).toBeNull()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Gemini models' })).toBeTruthy()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('gemini-2.5-pro', 'high')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes one nesting level with Escape and supports outside click', () => {
    renderPicker()
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Claude models' })).toBeNull()
    expect(screen.getByRole('tree')).toBeTruthy()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tree')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('treeitem', { name: 'GPT' }))
    fireEvent.keyDown(trigger, { key: 'ArrowLeft' })
    expect(screen.queryByRole('group', { name: 'GPT models' })).toBeNull()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('keeps unknown models and a missing active model visible without selecting it', () => {
    const onChange = renderPicker({ ...session, model: 'retired', models: [models[5]] })
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Current model' }))
    const current = screen.getByRole('treeitem', { name: 'retired' })
    expect(current.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(current)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('treeitem', { name: 'Other models' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Future model' }))
    expect(onChange).toHaveBeenCalledWith('new-model', 'high')
  })

  it('shows only available families, even with a single model', () => {
    renderPicker({ ...session, model: 'gpt-4.1', models: [models[1]] })
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    expect(screen.getAllByRole('treeitem')).toHaveLength(1)
    expect(screen.getByRole('treeitem', { name: 'GPT' })).toBeTruthy()
  })

  it('retains the chosen effort when switching to a model that supports it', () => {
    const onChange = renderPicker({ ...session, reasoningEffort: 'low' })
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude Sonnet 4.5' }))
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4.5', 'low')
  })

  it('falls back to the new model default when the previous effort is unsupported', () => {
    const onChange = renderPicker({ ...session, reasoningEffort: 'max' })
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude Sonnet 4.5' }))
    expect(onChange).toHaveBeenCalledWith('claude-sonnet-4.5', 'high')
  })

  it('shows queued settings rather than the running turn’s model and effort', () => {
    const onChange = renderPicker({
      ...session,
      phase: 'running',
      nextModelSelection: { model: 'gpt-4.1', reasoningEffort: null }
    })
    expect((screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement).value).toBe(
      'gpt-4.1'
    )
    expect(
      (screen.getByRole('combobox', { name: 'Reasoning effort' }) as HTMLButtonElement).value
    ).toBe('')
    expect(screen.getByText('For next message')).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: 'Reasoning effort' }))
    fireEvent.click(screen.getByRole('option', { name: 'Low' }))
    expect(onChange).toHaveBeenCalledWith('gpt-4.1', 'low')
  })
})
