// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'

vi.mock('../shared/api/client', () => ({
  getRendererApi: () => ({
    appState: {
      onSidebarContextMenuAction: () => () => {},
      showSidebarContextMenu: vi.fn()
    }
  })
}))

afterEach(cleanup)

it('shows only the unified thread view without a mode switch', () => {
  render(
    <Sidebar
      snapshot={{
        repositories: [],
        settings: {
          yoloEnabled: true,
          terminalFontFamilyInput: '',
          taskTagsInput: '',
          parsedTaskTags: [],
          resolvedTerminalFontFamily: 'monospace'
        },
        selectedRepositoryId: null,
        selectedThreadId: null,
        sidebarWidth: 268
      }}
      selectedRepository={null}
      selectedThread={null}
      sessions={new Map()}
      busyAddRepository={false}
      convertingThread={false}
      closingThread={false}
      onSelectRepository={vi.fn()}
      onSelectThread={vi.fn()}
      onAddRepository={vi.fn()}
      onEditRepository={vi.fn()}
      onOpenRepositoryTasks={vi.fn()}
      onEditThread={vi.fn()}
      onNewThread={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenPerformance={vi.fn()}
      performanceOpen={false}
      onSettleThread={vi.fn()}
      onConvertThreadToWorktree={vi.fn()}
      onCloseThread={vi.fn()}
    />
  )
  expect(screen.getByText('Threads')).toBeTruthy()
  expect(screen.getByText('Add a repository to start a thread.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /switch to (projects|inbox) view/i })).toBeNull()
})
