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
      { action: 'convert-to-worktree', label: 'Converting...', enabled: false },
      { action: 'settle-thread', label: 'Settle thread', enabled: true },
      { action: 'close-thread', label: 'Closing...', enabled: false }
    ])
    expect(
      threadMenuActions({
        ...options,
        settled: true,
        convertToWorktreeEnabled: true,
        closeThreadEnabled: true,
        regenerateTitleEnabled: false
      })
    ).toEqual([
      { action: 'edit', label: 'Edit', enabled: true },
      { action: 'regenerate-title', label: 'Writing title...', enabled: false },
      { action: 'convert-to-worktree', label: 'Convert to work tree', enabled: true },
      { action: 'unsettle-thread', label: 'Unsettle thread', enabled: true },
      { action: 'close-thread', label: 'Close thread', enabled: true }
    ])
  })
})
