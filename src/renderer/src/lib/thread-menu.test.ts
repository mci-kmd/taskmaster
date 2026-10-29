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
})
