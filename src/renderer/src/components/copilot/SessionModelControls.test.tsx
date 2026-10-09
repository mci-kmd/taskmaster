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
  mcpServersNeedingAuth: [],
  mcpServersSigningIn: [],
  queuedMessages: [],
  steeringMessages: [],
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

  it('lists duplicate catalog entries once and keeps families separate', () => {
    renderPicker({ ...session, models: [...models, ...models] })
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.pointerMove(screen.getByRole('treeitem', { name: 'GPT' }))
    fireEvent.pointerMove(screen.getByRole('treeitem', { name: 'Claude' }))
    expect(
      within(screen.getByRole('group', { name: 'Claude models' }))
        .getAllByRole('treeitem')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Claude Sonnet 4.5', 'Claude Haiku 4.5'])
  })

  it('does not scroll menus when hovering models', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderPicker()
      fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
      scrollIntoView.mockClear()
      fireEvent.pointerMove(screen.getByRole('treeitem', { name: 'Claude' }))
      fireEvent.pointerMove(screen.getByRole('treeitem', { name: 'Claude Haiku 4.5' }))
      expect(scrollIntoView).not.toHaveBeenCalled()
      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Model' }), { key: 'ArrowUp' })
      expect(scrollIntoView).toHaveBeenCalled()
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
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

describe('favorite models', () => {
  function renderFavorites(favorites: string[]): {
    onChange: ReturnType<typeof vi.fn>
    onToggleFavorite: ReturnType<typeof vi.fn>
    rerender: (favorites: string[]) => void
  } {
    const onChange = vi.fn()
    const onToggleFavorite = vi.fn()
    const element = (favoriteModels: string[]): React.JSX.Element => (
      <SessionModelControls
        session={session}
        disabled={false}
        busy={false}
        disabledReason=""
        favoriteModels={favoriteModels}
        onChange={onChange}
        onToggleFavorite={onToggleFavorite}
      />
    )
    const view = render(element(favorites))
    return {
      onChange,
      onToggleFavorite,
      rerender: (next) => view.rerender(element(next))
    }
  }

  it('hides the favorites group when nothing is starred', () => {
    renderFavorites([])
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    expect(screen.queryByRole('group', { name: 'Favorites' })).toBeNull()
    expect(screen.queryByText('Favorites')).toBeNull()
  })

  it('stars models from a family and lists favorites below the families', () => {
    const { onChange, onToggleFavorite, rerender } = renderFavorites([])
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    const star = screen.getByRole('button', { name: 'Add Claude Haiku 4.5 to favorites' })
    expect(star.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(star)
    expect(onToggleFavorite).toHaveBeenCalledWith('claude-haiku-4.5', true)
    expect(onChange).not.toHaveBeenCalled()

    rerender(['claude-haiku-4.5', 'retired-model', 'gemini-2.5-pro'])
    expect(
      within(screen.getByRole('group', { name: 'Claude models' }))
        .getByRole('button', { name: 'Remove Claude Haiku 4.5 from favorites' })
        .getAttribute('aria-pressed')
    ).toBe('true')
    const tree = screen.getByRole('tree', { name: 'Model families' })
    const favorites = within(tree).getByRole('group', { name: 'Favorites' })
    expect(
      within(favorites)
        .getAllByRole('treeitem')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Claude Haiku 4.5', 'Gemini 2.5 Pro'])
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((row) => row.getAttribute('aria-label'))
    ).toEqual(['Claude', 'GPT', 'Gemini', 'Other models', 'Claude Haiku 4.5', 'Gemini 2.5 Pro'])

    fireEvent.click(within(favorites).getByRole('treeitem', { name: 'Gemini 2.5 Pro' }))
    expect(onChange).toHaveBeenCalledWith('gemini-2.5-pro', 'high')
    expect(screen.queryByRole('tree')).toBeNull()
  })

  it('reaches favorites and toggles stars with the keyboard', () => {
    const { onChange, onToggleFavorite } = renderFavorites(['gpt-4.1'])
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'End' })
    const favorite = within(screen.getByRole('group', { name: 'Favorites' })).getByRole(
      'treeitem',
      { name: 'GPT-4.1' }
    )
    expect(trigger.getAttribute('aria-activedescendant')).toBe(favorite.id)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('gpt-4.1', 'high')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'End' })
    fireEvent.keyDown(trigger, { key: '*' })
    expect(onToggleFavorite).toHaveBeenCalledWith('gpt-4.1', false)
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: 'Other models' }).id
    )
    fireEvent.keyDown(trigger, { key: 'ArrowRight' })
    fireEvent.keyDown(trigger, { key: '*' })
    expect(onToggleFavorite).toHaveBeenLastCalledWith('new-model', true)
  })
})

describe('legacy models', () => {
  const rows = (family: string): (string | null)[] =>
    within(screen.getByRole('group', { name: `${family} models` }))
      .getAllByRole('treeitem')
      .map((row) => row.getAttribute('aria-label'))

  it('tucks legacy models under a Legacy row in their family', () => {
    const onChange = vi.fn()
    render(
      <SessionModelControls
        session={session}
        disabled={false}
        busy={false}
        disabledReason=""
        legacyModels={['claude-haiku-4.5']}
        onChange={onChange}
      />
    )
    const picker = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude' }))
    expect(rows('Claude')).toEqual(['Claude Sonnet 4.5', 'Legacy'])
    const legacy = screen.getByRole('treeitem', { name: 'Legacy' })
    expect(legacy.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(legacy)
    expect(rows('Claude')).toEqual(['Claude Sonnet 4.5', 'Legacy', 'Claude Haiku 4.5'])
    fireEvent.click(screen.getByRole('treeitem', { name: 'Claude Haiku 4.5' }))
    expect(onChange).toHaveBeenCalledWith('claude-haiku-4.5', 'high')

    // Families without legacy models have no Legacy row.
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('treeitem', { name: 'GPT' }))
    expect(rows('GPT')).toEqual(['GPT-4.1', 'GPT-5 mini'])
  })

  it('opens the Legacy row for a legacy current model and reaches it by keyboard', () => {
    render(
      <SessionModelControls
        session={{ ...session, model: 'gpt-4.1' }}
        disabled={false}
        busy={false}
        disabledReason=""
        legacyModels={['gpt-4.1']}
        onChange={vi.fn()}
      />
    )
    const picker = screen.getByRole('combobox', { name: 'Model' })
    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    fireEvent.keyDown(picker, { key: 'ArrowRight' })
    expect(rows('GPT')).toEqual(['GPT-5 mini', 'Legacy', 'GPT-4.1'])
    expect(picker.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: 'GPT-4.1' }).id
    )
    fireEvent.keyDown(picker, { key: 'ArrowUp' })
    expect(picker.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('treeitem', { name: 'Legacy' }).id
    )
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(rows('GPT')).toEqual(['GPT-5 mini', 'Legacy'])
  })
})
