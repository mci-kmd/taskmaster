// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import Workspace from './Workspace'

const api = vi.hoisted(() => ({
  terminal: { getStatus: vi.fn(() => new Promise(() => {})) },
  copilot: { onSession: () => () => {} }
}))
vi.mock('../shared/api/client', () => ({ getRendererApi: () => api }))
vi.mock('../shared/hooks/use-branch-status', () => ({
  useBranchStatus: () => ({
    branchStatus: null,
    branchStatusSummary: null,
    branchStatusTitle: null
  })
}))
vi.mock('./TerminalSessions', () => ({ default: () => null }))
vi.mock('./CopilotThreadView', () => ({ default: () => <div>Conversation</div> }))

function props(agentInterface: 'custom' | 'cli' = 'custom'): ComponentProps<typeof Workspace> {
  const thread = {
    id: 'thread',
    repositoryId: 'repo',
    agentInterface,
    displayTitle: 'Thread',
    cwd: '/repo',
    mode: 'active-branch',
    hasLaunched: false
  } as ThreadSnapshot
  return {
    selectedRepository: {
      id: 'repo',
      name: 'Project',
      path: '/repo',
      backend: { kind: 'native' }
    } as RepositorySnapshot,
    selectedThread: thread,
    threads: [thread],
    settings: {} as ComponentProps<typeof Workspace>['settings'],
    hasRepositories: true,
    showRepositoryTasks: false,
    autoLaunchThreadId: null,
    repositoryTaskBusy: false,
    runCommandBusy: false,
    onAutoLaunchHandled: vi.fn(),
    onRefresh: vi.fn(),
    onAddRepository: vi.fn(),
    onCreateRepositoryTask: vi.fn(),
    onCompleteRepositoryTask: vi.fn(),
    onUpdateRepositoryTask: vi.fn(),
    onNewThread: vi.fn(),
    onStartRunCommand: vi.fn(),
    onStopRunCommand: vi.fn(),
    onOpenWorkingDirectory: vi.fn(),
    onOpenWorkingDirectoryInVscode: vi.fn(),
    onOpenSolutionInVisualStudio: vi.fn(),
    onSessionsChange: vi.fn()
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('opens Custom UI threads without checking the legacy CLI', async () => {
  render(<Workspace {...props()} />)
  await screen.findByText('Conversation')
  expect(api.terminal.getStatus).not.toHaveBeenCalled()
})

it('checks the CLI only when a legacy thread is selected, without repeating on snapshot refresh', () => {
  const { rerender } = render(<Workspace {...props()} />)
  const legacy = props('cli')
  rerender(<Workspace {...legacy} />)
  expect(api.terminal.getStatus).toHaveBeenCalledTimes(1)
  rerender(
    <Workspace
      {...legacy}
      selectedRepository={{ ...legacy.selectedRepository!, backend: { kind: 'native' } }}
    />
  )
  expect(api.terminal.getStatus).toHaveBeenCalledTimes(1)
})
