// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import Workspace from './Workspace'

const api = vi.hoisted(() => {
  const listeners = new Set<(event: { snapshot: unknown }) => void>()
  return {
    listeners,
    copilot: {
      onSession: (listener: (event: { snapshot: unknown }) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }
})
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
vi.mock('./preview/ThreadPreviewView', () => ({
  default: ({ previewUrl }: { previewUrl: string }) => <div>Preview of {previewUrl}</div>
}))

function props(
  threadOverrides: Partial<ThreadSnapshot> = {},
  repositoryOverrides: Partial<RepositorySnapshot> = {}
): ComponentProps<typeof Workspace> {
  const thread = {
    id: 'thread',
    repositoryId: 'repo',
    displayTitle: 'Thread',
    cwd: '/repo',
    mode: 'active-branch',
    previewUrl: null,
    isRunCommandRunning: false,
    ...threadOverrides
  } as ThreadSnapshot
  return {
    selectedRepository: {
      id: 'repo',
      name: 'Project',
      path: '/repo',
      backend: { kind: 'native' },
      ...repositoryOverrides
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
    onReopenRepositoryTask: vi.fn(),
    onUpdateRepositoryTask: vi.fn(),
    onReorderRepositoryTasks: vi.fn(),
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

it('offers the preview only for projects that opt in', () => {
  render(<Workspace {...props()} />)
  expect(screen.queryByRole('radio', { name: 'Preview' })).toBeNull()
})

it('disables the preview until the run command is running', async () => {
  const { rerender } = render(
    <Workspace {...props({ previewUrl: 'http://localhost:4000' }, { runCommand: 'bun run dev' })} />
  )
  const tab = screen.getByRole('radio', { name: 'Preview' })
  expect(tab.getAttribute('aria-disabled')).toBe('true')
  expect(tab.getAttribute('title')).toMatch(/Start the run command/)
  fireEvent.click(tab)
  await screen.findByText('Conversation')
  expect(screen.queryByText(/Preview of/)).toBeNull()

  rerender(
    <Workspace
      {...props(
        { previewUrl: 'http://localhost:4000', isRunCommandRunning: true },
        { runCommand: 'bun run dev' }
      )}
    />
  )
  fireEvent.click(screen.getByRole('radio', { name: 'Preview' }))
  await screen.findByText('Preview of http://localhost:4000')

  rerender(
    <Workspace {...props({ previewUrl: 'http://localhost:4000' }, { runCommand: 'bun run dev' })} />
  )
  await screen.findByText('Conversation')
  expect(screen.queryByText(/Preview of/)).toBeNull()
})

it('explains that the preview needs a run command', () => {
  render(<Workspace {...props({ previewUrl: 'http://localhost:4000' })} />)
  expect(screen.getByRole('radio', { name: 'Preview' }).getAttribute('title')).toMatch(
    /Add a run command/
  )
})

function emitSession(phase: 'running' | 'idle'): void {
  act(() => {
    for (const listener of api.listeners) {
      listener({
        snapshot: {
          threadId: 'thread',
          title: null,
          phase,
          timeline: [],
          pendingInteraction: null,
          error: null
        }
      })
    }
  })
}

it('keeps the open thread done until the user interacts with it', async () => {
  const onSessionsChange = vi.fn()
  render(<Workspace {...props()} onSessionsChange={onSessionsChange} />)
  const conversation = await screen.findByText('Conversation')
  emitSession('running')
  emitSession('idle')
  emitSession('idle')

  expect(screen.getByRole('button', { name: 'Dismiss done state' })).toBeTruthy()
  expect(onSessionsChange.mock.lastCall?.[0].get('thread').copilotStatus).toBe('done')

  fireEvent.keyDown(conversation, { key: 'Alt' })
  expect(screen.getByRole('button', { name: 'Dismiss done state' })).toBeTruthy()

  fireEvent.pointerDown(conversation)
  expect(screen.queryByRole('button', { name: 'Dismiss done state' })).toBeNull()
  expect(onSessionsChange.mock.lastCall?.[0].get('thread').copilotStatus).toBe('idle')
})
