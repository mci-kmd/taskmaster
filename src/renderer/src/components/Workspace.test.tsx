// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, it, vi } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import Workspace from './Workspace'

const api = vi.hoisted(() => ({
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

function props(): ComponentProps<typeof Workspace> {
  const thread = {
    id: 'thread',
    repositoryId: 'repo',
    displayTitle: 'Thread',
    cwd: '/repo',
    mode: 'active-branch'
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
    repositoryTaskBusy: false,
    runCommandBusy: false,
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

it('opens SDK conversations for selected threads', async () => {
  render(<Workspace {...props()} />)
  await screen.findByText('Conversation')
})
