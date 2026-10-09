// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  RepositorySnapshot,
  ThreadSnapshot,
  UpdateRepositoryInput
} from '../../../../shared/app-types'
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
    commitPhase: null,
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
  return { id, number: 1, title: id, description: '', tags: [], createdAt: '2026-01-01' }
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
    removing: false,
    workingThreadCount: 0,
    onClose: vi.fn(),
    onBrowseFavicon: vi.fn(async () => null),
    onBrowseSolutionFile: vi.fn(async () => null),
    onSave: vi.fn(async () => ({ ok: true })),
    onRemove: vi.fn(async () => true),
    ...props
  }
  render(<EditRepositoryDialog {...allProps} />)
  return allProps
}

it('confirms removal with counts of threads and tasks that will be lost', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Danger zone' }))
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

it('returns to the editor when removal is cancelled, keeping unsaved edits', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Danger zone' }))
  await user.click(screen.getByRole('button', { name: 'Remove…' }))
  await user.keyboard('{Escape}')

  expect(screen.getByRole('heading', { name: 'Edit project' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'Danger zone' }).getAttribute('aria-selected')).toBe(
    'true'
  )
  expect(screen.queryByRole('list', { name: 'Data that will be lost' })).toBeNull()
  expect(props.onRemove).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
})

it('disables removal while project threads are working', async () => {
  const user = userEvent.setup()
  renderDialog({ workingThreadCount: 2 })

  await user.click(screen.getByRole('tab', { name: 'Danger zone' }))

  expect(screen.getByRole('button', { name: 'Remove…' })).toHaveProperty('disabled', true)
  expect(screen.getByText(/2 threads are still working/)).toBeTruthy()
})

it('does not offer removal for the built-in project', () => {
  renderDialog({ repository: { ...repository, kind: 'general', name: 'Computer' } })

  expect(screen.queryByRole('tab', { name: 'Danger zone' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull()
})

it('defaults the commit model and saves each commit setting as it changes', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Commits' }))
  await screen.findByText('Luna 6')
  const push = screen.getByRole('checkbox', { name: 'Push to the remote after committing' })
  expect(push).toHaveProperty('checked', false)
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

  await user.click(screen.getByRole('combobox', { name: 'Commit message reasoning effort' }))
  await user.click(screen.getByRole('option', { name: 'High' }))

  expect(props.onSave).toHaveBeenCalledTimes(1)
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      repositoryId: 'repo-1',
      commitMessageModel: { model: 'gpt-6-luna', reasoningEffort: 'high' },
      autoPushAfterCommit: false
    })
  )

  await user.click(push)

  expect(props.onSave).toHaveBeenCalledTimes(2)
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      commitMessageModel: { model: 'gpt-6-luna', reasoningEffort: 'high' },
      autoPushAfterCommit: true
    })
  )
})

it('resets the commit model to the default', async () => {
  const user = userEvent.setup()
  const props = renderDialog({
    repository: {
      ...repository,
      commitMessageModel: { model: 'fast-model', reasoningEffort: null },
      autoPushAfterCommit: true
    }
  })

  await user.click(screen.getByRole('tab', { name: 'Commits' }))
  await screen.findByText('Fast model')
  const push = screen.getByRole('checkbox', { name: 'Push to the remote after committing' })
  expect(push).toHaveProperty('checked', true)

  await user.click(screen.getByRole('button', { name: 'Reset to default' }))
  await screen.findByText('Luna 6')
  expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ commitMessageModel: null, autoPushAfterCommit: true })
  )

  await user.click(push)
  expect(props.onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ commitMessageModel: null, autoPushAfterCommit: false })
  )
})

it('shows validation errors inline and keeps the last valid value for later saves', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn(async (input: UpdateRepositoryInput) =>
    input.previewUrl === 'localhost'
      ? { ok: false, error: 'Preview URL must be an http:// or https:// address.' }
      : { ok: true }
  )
  renderDialog({ onSave })

  await user.click(screen.getByRole('tab', { name: 'Run & preview' }))
  const previewUrl = screen.getByLabelText('Preview URL')
  await user.type(previewUrl, 'localhost')
  await user.keyboard('{Enter}')

  expect(
    await screen.findByText('Preview URL must be an http:// or https:// address.')
  ).toBeTruthy()
  expect(previewUrl.getAttribute('aria-invalid')).toBe('true')
  expect(previewUrl.getAttribute('aria-describedby')).toContain(
    screen.getByText('Preview URL must be an http:// or https:// address.').id
  )
  expect(
    within(screen.getByRole('tab', { name: /Run & preview/ })).getByRole('img', {
      name: 'Has unsaved changes'
    })
  ).toBeTruthy()

  await user.type(screen.getByLabelText('Run command'), 'bun run dev')
  await user.tab()

  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ runCommand: 'bun run dev', previewUrl: null })
  )
  // The rejected value stays in the field so it can be corrected.
  expect(previewUrl).toHaveProperty('value', 'localhost')

  await user.clear(previewUrl)
  await user.type(previewUrl, 'http://localhost:5173')
  await user.tab()

  expect(onSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ runCommand: 'bun run dev', previewUrl: 'http://localhost:5173' })
  )
  await waitFor(() =>
    expect(screen.queryByText('Preview URL must be an http:// or https:// address.')).toBeNull()
  )
  expect(previewUrl.getAttribute('aria-invalid')).toBeNull()
})

it('saves a browsed favicon right away', async () => {
  const user = userEvent.setup()
  const props = renderDialog({ onBrowseFavicon: vi.fn(async () => 'public/favicon.ico') })

  await user.click(screen.getByRole('button', { name: 'Browse for a favicon file' }))

  expect(props.onBrowseFavicon).toHaveBeenCalledWith('repo-1')
  expect(screen.getByLabelText('Favicon')).toHaveProperty('value', 'public/favicon.ico')
  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ faviconPath: 'public/favicon.ico' })
  )
})

it('flushes a pending edit when the dialog is closed', async () => {
  const user = userEvent.setup()
  const props = renderDialog()

  await user.click(screen.getByRole('tab', { name: 'Worktrees' }))
  await user.type(screen.getByLabelText('Setup script'), 'bun install')
  expect(props.onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Close dialog' }))

  expect(props.onClose).toHaveBeenCalled()
  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ newWorktreeSetupCommand: 'bun install' })
  )
})

it('auto-saves the built-in project title and rejects an empty one', async () => {
  const user = userEvent.setup()
  const props = renderDialog({ repository: { ...repository, kind: 'general', name: 'Computer' } })

  const title = screen.getByLabelText('Project title')
  expect(document.activeElement).toBe(title)
  await user.clear(title)
  await user.tab()

  expect(await screen.findByText('Enter a project title.')).toBeTruthy()
  expect(props.onSave).not.toHaveBeenCalled()

  await user.type(title, 'Desktop')
  await user.tab()

  expect(props.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ repositoryId: 'repo-1', name: 'Desktop' })
  )
  await waitFor(() => expect(screen.queryByText('Enter a project title.')).toBeNull())
})
