// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../../shared/app-types'
import EditRepositoryDialog from './EditRepositoryDialog'

const copilot = vi.hoisted(() => ({
  listModels: vi.fn(async () => ({
    models: [
      {
        id: 'gpt-6-luna',
        name: 'Luna 6',
        supportsVision: false,
        supportedReasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      },
      {
        id: 'fast-model',
        name: 'Fast model',
        supportsVision: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null
      }
    ]
  }))
}))
vi.mock('../../shared/api/client', () => ({ getRendererApi: () => ({ copilot }) }))

afterEach(cleanup)

function thread(id: string, settledAt?: string): ThreadSnapshot {
  return {
    id,
    repositoryId: 'repo-1',
    latestCopilotTitle: null,
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'worktree',
    projectKind: 'repository',
    branchName: id,
    worktreePath: `/repo/.worktrees/${id}`,
    createdAt: '2026-01-01',
    executionCwd: '/repo',
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    previewUrl: null,
    commitAutoPush: false,
    customTitle: id,
    displayTitle: id,
    lastActivityAt: '2026-01-01',
    settledAt,
    displayBranchName: id,
    cwd: '/repo'
  }
}

function task(id: string): RepositorySnapshot['tasks'][number] {
  return { id, title: id, description: '', tags: [], createdAt: '2026-01-01' }
}

const repository: RepositorySnapshot = {
  id: 'repo-1',
  name: 'Alpha',
  path: '/repo',
  threads: [thread('a'), thread('b'), thread('c', '2026-01-02')],
  backend: { kind: 'native' },
  faviconPath: null,
  runCommand: null,
  solutionFilePath: null,
  newWorktreeSetupCommand: null,
  postWorktreeRemoveCommand: null,
  addedAt: '2026-01-01',
  lastActivityAt: '2026-01-01',
  tasks: [task('t1'), task('t2'), task('t3')],
  completedTasks: [{ ...task('t4'), completedAt: '2026-01-03' }],
  currentBranch: 'main',
  primaryBranch: 'main',
  branchOptions: [],
  worktreeOptions: [],
  faviconUrl: null
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof EditRepositoryDialog>> = {}
): React.ComponentProps<typeof EditRepositoryDialog> {
  const allProps: React.ComponentProps<typeof EditRepositoryDialog> = {
    open: true,
    repository,
    busy: false,
    removing: false,
    workingThreadCount: 0,
    onClose: vi.fn(),
    onBrowseFavicon: vi.fn(async () => null),
    onBrowseSolutionFile: vi.fn(async () => null),
    onSubmit: vi.fn(async () => true),
    onRemove: vi.fn(async () => true),
    ...props
  }
  render(<EditRepositoryDialog {...allProps} />)
  return allProps
}

it('confirms removal with counts of threads and tasks that will be lost', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('button', { name: 'Remove…' }))

  expect(screen.getByRole('heading', { name: 'Remove project?' })).toBeTruthy()
  const rows = within(screen.getByRole('list', { name: 'Data that will be lost' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent)
  expect(rows).toEqual(['Active threads2', 'Settled threads1', 'Tasks3 open, 1 completed4'])
  expect(props.onRemove).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Remove project' }))

  expect(props.onRemove).toHaveBeenCalledWith('repo-1')
})

it('returns to the editor when removal is cancelled', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('button', { name: 'Remove…' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.getByRole('heading', { name: 'Edit project' })).toBeTruthy()
  expect(screen.queryByRole('list', { name: 'Data that will be lost' })).toBeNull()
  expect(props.onRemove).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
})

it('disables removal while project threads are working', () => {
  renderDialog({ workingThreadCount: 2 })

  expect(screen.getByRole('button', { name: 'Remove…' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/2 threads are still working/)).toBeTruthy()
})

it('does not offer removal for the built-in project', () => {
  renderDialog({ repository: { ...repository, kind: 'general', name: 'Computer' } })

  expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull()
})

it('defaults the commit model and saves commit settings', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await screen.findByText('Luna 6')
  const push = screen.getByRole('checkbox', { name: 'Push to the remote after committing' })
  expect(push).toHaveProperty('checked', false)
  expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)

  await user.click(screen.getByRole('combobox', { name: 'Commit message reasoning effort' }))
  await user.click(screen.getByRole('option', { name: 'High' }))
  await user.click(push)
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(props.onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      commitMessageModel: { model: 'gpt-6-luna', reasoningEffort: 'high' },
      autoPushAfterCommit: true
    })
  )
})

it('saves the default commit model as a reset and clears commit settings', async () => {
  const user = userEvent.setup()
  const props = renderDialog({
    repository: {
      ...repository,
      commitMessageModel: { model: 'fast-model', reasoningEffort: null },
      autoPushAfterCommit: true
    }
  })

  await screen.findByText('Fast model')
  expect(
    screen.getByRole('checkbox', { name: 'Push to the remote after committing' })
  ).toHaveProperty('checked', true)

  await user.click(screen.getByRole('button', { name: 'Clear fields' }))
  await screen.findByText('Luna 6')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(props.onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ commitMessageModel: null, autoPushAfterCommit: false })
  )
})
