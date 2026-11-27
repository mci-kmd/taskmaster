import { describe, expect, it } from 'vitest'
import type { ThreadSnapshot } from '../../../shared/app-types'
import { threadMenuActions, threadMenuOptions } from './thread-menu'

describe('thread menu actions', () => {
  it('hides worktree conversion for general project threads', () => {
    const thread = { mode: 'active-branch', projectKind: 'general', settledAt: null }
    expect(
      threadMenuOptions(thread as unknown as ThreadSnapshot, false, false).convertToWorktreeVisible
    ).toBe(false)
    expect(
      threadMenuOptions(
        { ...thread, projectKind: 'repository' } as unknown as ThreadSnapshot,
        false,
        false
      ).convertToWorktreeVisible
    ).toBe(true)
  })

  it('offers forking once the thread has a Copilot conversation', () => {
    const thread = { mode: 'active-branch', projectKind: 'repository', settledAt: null }
    expect(
      threadMenuOptions(
        { ...thread, resumeSessionId: null } as unknown as ThreadSnapshot,
        false,
        false
      ).forkThreadEnabled
    ).toBe(false)
    expect(
      threadMenuOptions(
        { ...thread, resumeSessionId: 's1' } as unknown as ThreadSnapshot,
        false,
        false
      ).forkThreadEnabled
    ).toBe(true)
  })

  it('offers settle, close and conversion on the unified thread list', () => {
    const options = {
      settled: false,
      convertToWorktreeVisible: true,
      convertToWorktreeEnabled: false,
      closeThreadEnabled: false
    }
    expect(threadMenuActions(options)).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'regenerate-title', label: 'Regenerate title', enabled: true },
      { action: 'fork-thread', label: 'Fork thread', enabled: false },
      { action: 'convert-to-worktree', label: 'Converting...', enabled: false },
      {
        action: 'snooze',
        label: 'Snooze',
        enabled: true,
        children: [
          { action: 'snooze-hour', label: '1 hour', enabled: true },
          { action: 'snooze-tomorrow', label: 'Tomorrow', enabled: true },
          { action: 'snooze-next-week', label: 'Next week', enabled: true },
          { action: 'snooze-custom', label: 'Custom...', enabled: true }
        ]
      },
      { action: 'settle-thread', label: 'Settle thread', enabled: true },
      { action: 'close-thread', label: 'Closing...', enabled: false }
    ])
    expect(
      threadMenuActions({
        ...options,
        settled: true,
        convertToWorktreeEnabled: true,
        closeThreadEnabled: true,
        regenerateTitleEnabled: false,
        forkThreadEnabled: true
      })
    ).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'regenerate-title', label: 'Writing title...', enabled: false },
      { action: 'fork-thread', label: 'Fork thread', enabled: true },
      { action: 'convert-to-worktree', label: 'Convert to work tree', enabled: true },
      { action: 'unsettle-thread', label: 'Unsettle thread', enabled: true },
      { action: 'close-thread', label: 'Close thread', enabled: true }
    ])
  })

  it('offers unsnoozing a snoozed thread', () => {
    const thread = { mode: 'worktree', projectKind: 'repository', settledAt: null }
    const options = threadMenuOptions(
      { ...thread, snoozedUntil: '2026-01-02T08:00:00.000Z' } as unknown as ThreadSnapshot,
      false,
      false
    )
    expect(options.snoozed).toBe(true)
    const actions = threadMenuActions(options).map(({ action, label }) => [action, label])
    expect(actions).toContainEqual(['snooze', 'Snooze again'])
    expect(actions).toContainEqual(['unsnooze', 'Unsnooze'])
  })

  it('offers Auto settle only when linked to work items, and Disable auto settle when enabled', () => {
    const base = { mode: 'worktree', projectKind: 'repository', settledAt: null }
    const noItems = threadMenuActions(
      threadMenuOptions(base as unknown as ThreadSnapshot, false, false)
    ).map((entry) => entry.action)
    expect(noItems).not.toContain('auto-settle')
    expect(noItems).not.toContain('disable-auto-settle')

    const withTask = threadMenuActions(
      threadMenuOptions({ ...base, taskNumbers: [12] } as unknown as ThreadSnapshot, false, false)
    ).map(({ action, label }) => [action, label])
    expect(withTask).toContainEqual(['auto-settle', 'Auto settle'])
    expect(withTask).not.toContainEqual(['disable-auto-settle', 'Disable auto settle'])

    const enabledUnsettled = threadMenuActions(
      threadMenuOptions(
        { ...base, taskNumbers: [12], autoSettle: true } as unknown as ThreadSnapshot,
        false,
        false
      )
    ).map(({ action, label }) => [action, label])
    expect(enabledUnsettled).toContainEqual(['disable-auto-settle', 'Disable auto settle'])
    expect(enabledUnsettled).not.toContainEqual(['auto-settle', 'Auto settle'])

    const enabledSettled = threadMenuActions(
      threadMenuOptions(
        {
          ...base,
          settledAt: '2026-01-02T00:00:00.000Z',
          taskNumbers: [12],
          autoSettle: true
        } as unknown as ThreadSnapshot,
        false,
        false
      )
    ).map(({ action, label }) => [action, label])
    expect(enabledSettled).toContainEqual(['disable-auto-settle', 'Disable auto settle'])
    expect(enabledSettled).not.toContainEqual(['auto-settle', 'Auto settle'])
  })
})
