import { randomUUID } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, join } from 'path'
import { spawnSync } from 'child_process'
import { app, dialog, ipcMain } from 'electron'
import type {
  AppSnapshot,
  CreateThreadInput,
  MutationResult,
  PersistedAppState,
  PersistedRepository,
  PersistedThread,
  RepositorySnapshot,
  ThreadSnapshot,
  UpdateSettingsInput
} from '../shared/app-types'
import { getRunningThreadIds, killSessionsForThread } from './terminal'

const STORE_FILENAME = 'taskmaster-state.json'
const STATE_VERSION = 1 as const
const WORKTREE_SUFFIX_SEPARATOR = '--'

let persistedState: PersistedAppState | null = null

function getStorePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

function createDefaultState(): PersistedAppState {
  return {
    version: STATE_VERSION,
    settings: {
      globalFlagsInput: ''
    },
    repositories: [],
    threads: [],
    ui: {
      selectedRepositoryId: null,
      selectedThreadId: null
    }
  }
}

function ensureState(): PersistedAppState {
  if (persistedState) {
    return persistedState
  }

  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    persistedState = createDefaultState()
    return persistedState
  }

  const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as PersistedAppState
  if (parsed.version !== STATE_VERSION) {
    throw new Error(`Unsupported state version: ${parsed.version}`)
  }

  persistedState = parsed
  normalizeSelection(parsed)
  return parsed
}

function saveState(): void {
  const state = ensureState()
  normalizeSelection(state)

  const storePath = getStorePath()
  mkdirSync(dirname(storePath), { recursive: true })

  const tempPath = `${storePath}.tmp`
  writeFileSync(tempPath, JSON.stringify(state, null, 2))

  if (existsSync(storePath)) {
    unlinkSync(storePath)
  }

  renameSync(tempPath, storePath)
}

function normalizeSelection(state: PersistedAppState): void {
  const repositoryIds = new Set(state.repositories.map((repository) => repository.id))
  const threadsById = new Map(state.threads.map((thread) => [thread.id, thread] as const))

  if (state.ui.selectedRepositoryId && !repositoryIds.has(state.ui.selectedRepositoryId)) {
    state.ui.selectedRepositoryId = null
  }

  if (state.ui.selectedThreadId && !threadsById.has(state.ui.selectedThreadId)) {
    state.ui.selectedThreadId = null
  }

  if (state.ui.selectedThreadId) {
    state.ui.selectedRepositoryId = threadsById.get(state.ui.selectedThreadId)?.repositoryId ?? null
  }

  if (!state.ui.selectedRepositoryId && state.repositories.length > 0) {
    state.ui.selectedRepositoryId = state.repositories[0].id
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseGlobalFlags(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|[^\s]+/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[0]
    tokens.push(token.replace(/\\"/g, '"').replace(/\\'/g, "'"))
  }

  return tokens
}

function sameWindowsPath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`
    throw new Error(message)
  }

  return result.stdout.trim()
}

function tryGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  }
}

function resolveGitRoot(path: string): string | null {
  const result = tryGit(path, ['rev-parse', '--show-toplevel'])
  return result.ok ? result.stdout : null
}

function getCurrentBranchLabel(repoPath: string): string {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branchResult.ok) {
    return 'Unavailable'
  }

  if (branchResult.stdout === 'HEAD') {
    const headResult = tryGit(repoPath, ['rev-parse', '--short', 'HEAD'])
    return headResult.ok ? `HEAD (${headResult.stdout})` : 'HEAD'
  }

  return branchResult.stdout
}

function sanitizeWorktreeName(branchName: string): string {
  const sanitized = branchName
    .trim()
    .split('')
    .map((character) => {
      const codePoint = character.charCodeAt(0)
      return '<>:"/\\|?*'.includes(character) || codePoint < 32 ? '-' : character
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return sanitized || 'worktree'
}

function deriveWorktreePath(repoPath: string, branchName: string): string {
  const repoParent = dirname(repoPath)
  const repoName = basename(repoPath)
  const baseName = `${repoName}${WORKTREE_SUFFIX_SEPARATOR}${sanitizeWorktreeName(branchName)}`

  let candidate = join(repoParent, baseName)
  let suffix = 2

  while (existsSync(candidate)) {
    candidate = join(repoParent, `${baseName}-${suffix}`)
    suffix += 1
  }

  return candidate
}

function branchExists(repoPath: string, branchName: string): boolean {
  return tryGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]).ok
}

function createWorktree(repoPath: string, branchName: string): string {
  if (branchExists(repoPath, branchName)) {
    throw new Error(`Branch "${branchName}" already exists.`)
  }

  const worktreePath = deriveWorktreePath(repoPath, branchName)
  runGit(repoPath, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'])
  return worktreePath
}

function isDirtyGitPath(path: string): boolean {
  return runGit(path, ['status', '--porcelain', '--untracked-files=all']).length > 0
}

function removeWorktree(thread: PersistedThread, repositoryPath: string, force: boolean): void {
  if (
    thread.worktreePath &&
    existsSync(thread.worktreePath) &&
    statSync(thread.worktreePath).isDirectory()
  ) {
    const args = ['worktree', 'remove']
    if (force) {
      args.push('--force')
    }

    args.push(thread.worktreePath)
    runGit(repositoryPath, args)
  }

  if (branchExists(repositoryPath, thread.branchName)) {
    runGit(repositoryPath, ['branch', '-D', thread.branchName])
  }
}

function buildThreadSnapshot(
  repository: PersistedRepository,
  thread: PersistedThread,
  runningThreadIds: Set<string>
): ThreadSnapshot {
  return {
    ...thread,
    cwd: thread.mode === 'worktree' ? (thread.worktreePath ?? repository.path) : repository.path,
    displayBranchName:
      thread.mode === 'active-branch' ? getCurrentBranchLabel(repository.path) : thread.branchName,
    isRunning: runningThreadIds.has(thread.id)
  }
}

function buildRepositorySnapshot(
  repository: PersistedRepository,
  threads: PersistedThread[],
  runningThreadIds: Set<string>
): RepositorySnapshot {
  const snapshotThreads = threads
    .filter((thread) => thread.repositoryId === repository.id)
    .map((thread) => buildThreadSnapshot(repository, thread, runningThreadIds))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

  return {
    ...repository,
    currentBranch: getCurrentBranchLabel(repository.path),
    lastActivityAt: snapshotThreads[0]?.lastActivityAt ?? repository.addedAt,
    threads: snapshotThreads
  }
}

function buildSnapshot(): AppSnapshot {
  const state = ensureState()
  const runningThreadIds = getRunningThreadIds()

  const repositories = state.repositories
    .map((repository) => buildRepositorySnapshot(repository, state.threads, runningThreadIds))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

  return {
    repositories,
    settings: {
      ...state.settings,
      parsedGlobalFlags: parseGlobalFlags(state.settings.globalFlagsInput)
    },
    selectedRepositoryId: state.ui.selectedRepositoryId,
    selectedThreadId: state.ui.selectedThreadId
  }
}

function successResult(): MutationResult {
  return {
    ok: true,
    snapshot: buildSnapshot()
  }
}

function failureResult(error: string, cancelled = false): MutationResult {
  return {
    ok: false,
    cancelled,
    error,
    snapshot: buildSnapshot()
  }
}

function updateSelection(repositoryId: string | null, threadId: string | null): void {
  const state = ensureState()
  state.ui.selectedRepositoryId = repositoryId
  state.ui.selectedThreadId = threadId
}

function findThread(threadId: string): PersistedThread | undefined {
  return ensureState().threads.find((thread) => thread.id === threadId)
}

function createThread(input: CreateThreadInput): MutationResult {
  const state = ensureState()
  const repository = state.repositories.find((item) => item.id === input.repositoryId)

  if (!repository) {
    return failureResult('Repository not found.')
  }

  const createdAt = nowIso()
  const trimmedTitle = input.title?.trim()

  if (input.mode === 'worktree') {
    const branchName = input.branchName?.trim()
    if (!branchName) {
      return failureResult('Branch name is required for worktree threads.')
    }

    const thread: PersistedThread = {
      id: randomUUID(),
      repositoryId: repository.id,
      title: trimmedTitle || branchName,
      mode: 'worktree',
      branchName,
      worktreePath: createWorktree(repository.path, branchName),
      sessionName: `taskmaster-${randomUUID()}`,
      createdAt,
      lastActivityAt: createdAt,
      hasLaunched: false
    }

    state.threads.push(thread)
    updateSelection(repository.id, thread.id)
    saveState()
    return successResult()
  }

  const currentBranch = getCurrentBranchLabel(repository.path)
  const thread: PersistedThread = {
    id: randomUUID(),
    repositoryId: repository.id,
    title: trimmedTitle || currentBranch,
    mode: 'active-branch',
    branchName: currentBranch,
    worktreePath: null,
    sessionName: `taskmaster-${randomUUID()}`,
    createdAt,
    lastActivityAt: createdAt,
    hasLaunched: false
  }

  state.threads.push(thread)
  updateSelection(repository.id, thread.id)
  saveState()
  return successResult()
}

async function addRepository(): Promise<MutationResult> {
  const dialogResult = await dialog.showOpenDialog({
    title: 'Add repository',
    properties: ['openDirectory']
  })

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return failureResult('Repository selection cancelled.', true)
  }

  const gitRoot = resolveGitRoot(dialogResult.filePaths[0])
  if (!gitRoot) {
    return failureResult('Selected folder is not inside a git repository.')
  }

  const state = ensureState()
  const existing = state.repositories.find((repository) =>
    sameWindowsPath(repository.path, gitRoot)
  )
  if (existing) {
    updateSelection(existing.id, null)
    saveState()
    return successResult()
  }

  const repository: PersistedRepository = {
    id: randomUUID(),
    name: basename(gitRoot),
    path: gitRoot,
    addedAt: nowIso()
  }

  state.repositories.push(repository)
  updateSelection(repository.id, null)
  saveState()
  return successResult()
}

async function closeThread(threadId: string): Promise<MutationResult> {
  const state = ensureState()
  const thread = state.threads.find((item) => item.id === threadId)
  if (!thread) {
    return failureResult('Thread not found.')
  }

  const repository = state.repositories.find((item) => item.id === thread.repositoryId)
  if (!repository) {
    return failureResult('Owning repository not found.')
  }

  killSessionsForThread(threadId)

  if (thread.mode === 'worktree' && thread.worktreePath) {
    const dirty =
      existsSync(thread.worktreePath) && statSync(thread.worktreePath).isDirectory()
        ? isDirtyGitPath(thread.worktreePath)
        : false

    if (dirty) {
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Cancel', 'Delete anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Uncommitted changes',
        message: `The worktree for "${thread.title}" has uncommitted changes.`,
        detail: 'Delete anyway will remove the worktree and delete its branch.'
      })

      if (confirmation.response === 0) {
        return failureResult('Thread close cancelled.', true)
      }
    }

    removeWorktree(thread, repository.path, dirty)
  }

  state.threads = state.threads.filter((item) => item.id !== thread.id)

  if (state.ui.selectedThreadId === thread.id) {
    state.ui.selectedThreadId = null
    state.ui.selectedRepositoryId = repository.id
  }

  saveState()
  return successResult()
}

function updateSettings(input: UpdateSettingsInput): MutationResult {
  const state = ensureState()
  state.settings.globalFlagsInput = input.globalFlagsInput.trim()
  saveState()
  return successResult()
}

function selectRepository(repositoryId: string | null): AppSnapshot {
  updateSelection(repositoryId, null)
  saveState()
  return buildSnapshot()
}

function selectThread(threadId: string | null): AppSnapshot {
  if (!threadId) {
    const state = ensureState()
    state.ui.selectedThreadId = null
    saveState()
    return buildSnapshot()
  }

  const thread = findThread(threadId)
  if (!thread) {
    return buildSnapshot()
  }

  updateSelection(thread.repositoryId, thread.id)
  saveState()
  return buildSnapshot()
}

export function initializeAppState(): void {
  ensureState()
  saveState()
}

export function registerAppStateIpc(): void {
  ipcMain.handle('app-state:get-snapshot', () => buildSnapshot())
  ipcMain.handle('app-state:refresh', () => buildSnapshot())
  ipcMain.handle('app-state:add-repository', () => addRepository())
  ipcMain.handle('app-state:create-thread', (_event, input: CreateThreadInput) =>
    createThread(input)
  )
  ipcMain.handle('app-state:close-thread', (_event, threadId: string) => closeThread(threadId))
  ipcMain.handle('app-state:update-settings', (_event, input: UpdateSettingsInput) =>
    updateSettings(input)
  )
  ipcMain.handle('app-state:select-repository', (_event, repositoryId: string | null) =>
    selectRepository(repositoryId)
  )
  ipcMain.handle('app-state:select-thread', (_event, threadId: string | null) =>
    selectThread(threadId)
  )
}

export function markThreadLaunched(threadId: string): void {
  const thread = findThread(threadId)
  if (!thread) {
    return
  }

  thread.hasLaunched = true
  thread.lastActivityAt = nowIso()
  updateSelection(thread.repositoryId, thread.id)
  saveState()
}

export function markThreadActivity(threadId: string): void {
  const thread = findThread(threadId)
  if (!thread) {
    return
  }

  thread.lastActivityAt = nowIso()
  saveState()
}

export function markThreadStopped(threadId: string): void {
  const thread = findThread(threadId)
  if (!thread) {
    return
  }

  thread.lastActivityAt = nowIso()
  saveState()
}
