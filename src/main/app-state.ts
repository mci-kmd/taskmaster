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
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { spawn, spawnSync } from 'child_process'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import {
  type BranchStatusRequest,
  type BranchStatusSnapshot,
  type PickRepositoryFaviconResult,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type AppSnapshot,
  type CreateThreadInput,
  type MutationResult,
  type PersistedAppState,
  type PersistedRepository,
  type PersistedThread,
  type RepositorySnapshot,
  type ThreadSnapshot,
  type UpdateRepositoryInput,
  type UpdateThreadCopilotTitleInput,
  type UpdateSettingsInput,
  type UpdateUiInput
} from '../shared/app-types'
import { getRunningThreadIds, killSessionsForThread } from './terminal'

const STORE_FILENAME = 'taskmaster-state.json'
const STATE_VERSION = 4 as const
const WORKTREES_DIR_SUFFIX = '.worktrees'
const BRANCH_STATUS_CACHE_TTL_MS = 1_500
const REPOSITORY_FAVICON_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp'
])

let persistedState: PersistedAppState | null = null
const repositoryGitStateCache = new Map<string, RepositoryGitState>()
const branchStatusCache = new Map<
  string,
  { expiresAt: number; value: BranchStatusSnapshot | null }
>()
const branchStatusInflight = new Map<string, Promise<BranchStatusSnapshot | null>>()

type LegacyThreadV1 = Omit<PersistedThread, 'customTitle' | 'latestCopilotTitle'> & {
  title: string
}
type LegacyAppStateV1 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 1
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV1[]
}

type LegacyThreadV2 = Omit<PersistedThread, 'latestCopilotTitle'>
type LegacyRepositoryV3 = Omit<PersistedRepository, 'faviconPath'>
type LegacyAppStateV3 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 3
  repositories: LegacyRepositoryV3[]
}
type LegacyAppStateV2 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 2
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV2[]
}

type RepositoryGitState = {
  currentBranch: string
  primaryBranch: string | null
}

type RelativePathResult = { ok: true; path: string } | { ok: false; error: string }

type BuildSnapshotOptions = {
  refreshGit?: boolean
}

function migrateState(
  parsed: PersistedAppState | LegacyAppStateV3 | LegacyAppStateV2 | LegacyAppStateV1
): PersistedAppState {
  if (parsed.version === STATE_VERSION) {
    return parsed
  }

  const migratedRepositories = parsed.repositories.map((repository) => ({
    ...repository,
    faviconPath: null
  }))

  if (parsed.version === 3) {
    return {
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories
    }
  }

  if (parsed.version === 2) {
    return {
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: parsed.threads.map((thread) => ({
        ...thread,
        latestCopilotTitle: null
      }))
    }
  }

  if (parsed.version === 1) {
    const migratedThreads: PersistedThread[] = parsed.threads.map((thread) => {
      const trimmed = thread.title.trim()
      const looksAutoDerived = trimmed === '' || trimmed === thread.branchName
      const { title: _legacyTitle, ...rest } = thread
      void _legacyTitle
      return {
        ...rest,
        customTitle: looksAutoDerived ? null : trimmed,
        latestCopilotTitle: null
      }
    })

    return {
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: migratedThreads
    }
  }

  throw new Error(`Unsupported state version: ${(parsed as { version: number }).version}`)
}

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

  const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as
    | PersistedAppState
    | LegacyAppStateV2
    | LegacyAppStateV1
  const migrated = migrateState(parsed)
  persistedState = migrated
  normalizeSelection(migrated)
  return migrated
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

function isPathInsideRepository(repositoryPath: string, candidatePath: string): boolean {
  const relativePath = relative(repositoryPath, candidatePath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function resolveRepositoryAssetPath(repositoryPath: string, relativePath: string | null): string | null {
  if (!relativePath) {
    return null
  }

  const candidatePath = resolve(repositoryPath, relativePath)
  if (!isPathInsideRepository(repositoryPath, candidatePath)) {
    return null
  }

  if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
    return null
  }

  const extension = extname(candidatePath).toLowerCase()
  if (!REPOSITORY_FAVICON_EXTENSIONS.has(extension)) {
    return null
  }

  return candidatePath
}

function getRepositoryFaviconMimeType(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.bmp':
      return 'image/bmp'
    case '.gif':
      return 'image/gif'
    case '.ico':
      return 'image/x-icon'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    default:
      return null
  }
}

function buildRepositoryFaviconUrl(repositoryPath: string, relativePath: string | null): string | null {
  const resolvedPath = resolveRepositoryAssetPath(repositoryPath, relativePath)
  if (!resolvedPath) {
    return null
  }

  const mimeType = getRepositoryFaviconMimeType(resolvedPath)
  if (!mimeType) {
    return null
  }

  const encoded = readFileSync(resolvedPath).toString('base64')
  return `data:${mimeType};base64,${encoded}`
}

function validateRepositoryFaviconAbsolutePath(
  repositoryPath: string,
  candidatePath: string
): RelativePathResult {
  const normalizedCandidate = normalize(candidatePath)
  if (!isPathInsideRepository(repositoryPath, normalizedCandidate)) {
    return { ok: false, error: 'Favicon must be inside the repository.' }
  }

  if (!existsSync(normalizedCandidate)) {
    return { ok: false, error: 'Favicon file not found.' }
  }

  if (!statSync(normalizedCandidate).isFile()) {
    return { ok: false, error: 'Favicon path must point to a file.' }
  }

  const extension = extname(normalizedCandidate).toLowerCase()
  if (!REPOSITORY_FAVICON_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: 'Unsupported favicon file. Use .ico, .png, .svg, .jpg, .jpeg, .webp, .gif, or .bmp.'
    }
  }

  return {
    ok: true,
    path: normalize(relative(repositoryPath, normalizedCandidate))
  }
}

function validateRepositoryFaviconInput(
  repositoryPath: string,
  input: string | null
): RelativePathResult | { ok: true; path: null } {
  const trimmed = input?.trim() ?? ''
  if (!trimmed) {
    return { ok: true, path: null }
  }

  if (isAbsolute(trimmed)) {
    return { ok: false, error: 'Use a path relative to the repository root.' }
  }

  return validateRepositoryFaviconAbsolutePath(repositoryPath, resolve(repositoryPath, trimmed))
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

function tryGitAsync(
  cwd: string,
  args: string[]
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: { ok: boolean; stdout: string; stderr: string }): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish({
        ok: false,
        stdout: stdout.trim(),
        stderr: error.message
      })
    })

    child.on('close', (code) => {
      finish({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      })
    })
  })
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

function getPrimaryBranch(repoPath: string): string | null {
  const symref = tryGit(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (symref.ok && symref.stdout) {
    const candidate = symref.stdout.replace(/^origin\//, '')
    if (candidate && branchExists(repoPath, candidate)) {
      return candidate
    }
  }

  for (const candidate of ['main', 'master']) {
    if (branchExists(repoPath, candidate)) {
      return candidate
    }
  }

  return null
}

function hasUncommittedChanges(repoPath: string): boolean {
  const result = tryGit(repoPath, ['status', '--porcelain', '--untracked-files=no'])
  return result.ok && result.stdout.length > 0
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
  const worktreesDir = join(repoParent, `${repoName}${WORKTREES_DIR_SUFFIX}`)
  const baseName = sanitizeWorktreeName(branchName)

  let candidate = join(worktreesDir, baseName)
  let suffix = 2

  while (existsSync(candidate)) {
    candidate = join(worktreesDir, `${baseName}-${suffix}`)
    suffix += 1
  }

  return candidate
}

function branchExists(repoPath: string, branchName: string): boolean {
  return tryGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]).ok
}

function createWorktree(repoPath: string, branchName: string, baseRef: string): string {
  if (branchExists(repoPath, branchName)) {
    throw new Error(`Branch "${branchName}" already exists.`)
  }

  const worktreePath = deriveWorktreePath(repoPath, branchName)
  // Ensure the <repo>.worktrees container exists; git won't create
  // intermediate parents.
  mkdirSync(dirname(worktreePath), { recursive: true })
  runGit(repoPath, ['worktree', 'add', '-b', branchName, worktreePath, baseRef])
  return worktreePath
}

function isDirtyGitPath(path: string): boolean {
  return runGit(path, ['status', '--porcelain', '--untracked-files=all']).length > 0
}

function getThreadCwd(
  thread: Pick<PersistedThread, 'mode' | 'worktreePath'>,
  repositoryPath: string
): string {
  return thread.mode === 'worktree' ? (thread.worktreePath ?? repositoryPath) : repositoryPath
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

function readRepositoryGitState(repositoryPath: string): RepositoryGitState {
  return {
    currentBranch: getCurrentBranchLabel(repositoryPath),
    primaryBranch: getPrimaryBranch(repositoryPath)
  }
}

function getRepositoryGitState(
  repository: PersistedRepository,
  refreshGit: boolean
): RepositoryGitState {
  if (!refreshGit) {
    const cached = repositoryGitStateCache.get(repository.id)
    if (cached) {
      return cached
    }
  }

  const next = readRepositoryGitState(repository.path)
  repositoryGitStateCache.set(repository.id, next)
  return next
}

function parseBranchStatus(stdout: string): BranchStatusSnapshot {
  const status: BranchStatusSnapshot = {
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    deleted: 0,
    untracked: 0,
    conflicted: 0
  }

  for (const line of stdout.split(/\r?\n/)) {
    if (!line) {
      continue
    }

    if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      continue
    }

    if (line.startsWith('? ')) {
      status.untracked += 1
      continue
    }

    if (line.startsWith('u ')) {
      status.conflicted += 1
      continue
    }

    if (!line.startsWith('1 ') && !line.startsWith('2 ')) {
      continue
    }

    const xy = line.split(' ', 3)[1] ?? '..'
    const indexStatus = xy[0] ?? '.'
    const worktreeStatus = xy[1] ?? '.'

    if (indexStatus !== '.') {
      status.staged += 1
    }

    if (worktreeStatus === 'D') {
      status.deleted += 1
      continue
    }

    if (worktreeStatus !== '.') {
      status.modified += 1
    }
  }

  return status
}

function resolveBranchStatusCwd(input: BranchStatusRequest): string | null {
  const state = ensureState()

  if (input.threadId) {
    const thread = state.threads.find((item) => item.id === input.threadId)
    if (!thread) {
      return null
    }

    const repository = state.repositories.find((item) => item.id === thread.repositoryId)
    if (!repository) {
      return null
    }

    return getThreadCwd(thread, repository.path)
  }

  if (!input.repositoryId) {
    return null
  }

  return state.repositories.find((item) => item.id === input.repositoryId)?.path ?? null
}

async function getBranchStatus(input: BranchStatusRequest): Promise<BranchStatusSnapshot | null> {
  const cwd = resolveBranchStatusCwd(input)
  if (!cwd) {
    return null
  }

  const cacheKey = cwd.toLowerCase()
  const cached = branchStatusCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const inflight = branchStatusInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }

  const request = (async (): Promise<BranchStatusSnapshot | null> => {
    const result = await tryGitAsync(cwd, [
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all'
    ])
    const value = result.ok ? parseBranchStatus(result.stdout) : null

    branchStatusCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + BRANCH_STATUS_CACHE_TTL_MS
    })
    branchStatusInflight.delete(cacheKey)
    return value
  })()

  branchStatusInflight.set(cacheKey, request)
  return request
}

function buildThreadSnapshot(
  repository: PersistedRepository,
  thread: PersistedThread,
  runningThreadIds: Set<string>,
  repositoryGitState: RepositoryGitState
): ThreadSnapshot {
  const displayBranchName =
    thread.mode === 'active-branch' ? repositoryGitState.currentBranch : thread.branchName
  return {
    ...thread,
    cwd: getThreadCwd(thread, repository.path),
    displayBranchName,
    displayTitle: thread.customTitle ?? displayBranchName,
    isRunning: runningThreadIds.has(thread.id)
  }
}

function buildRepositorySnapshot(
  repository: PersistedRepository,
  threads: PersistedThread[],
  runningThreadIds: Set<string>,
  refreshGit: boolean
): RepositorySnapshot {
  const repositoryGitState = getRepositoryGitState(repository, refreshGit)
  const snapshotThreads = threads
    .filter((thread) => thread.repositoryId === repository.id)
    .map((thread) => buildThreadSnapshot(repository, thread, runningThreadIds, repositoryGitState))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))

  return {
    ...repository,
    currentBranch: repositoryGitState.currentBranch,
    faviconUrl: buildRepositoryFaviconUrl(repository.path, repository.faviconPath),
    primaryBranch: repositoryGitState.primaryBranch,
    lastActivityAt: snapshotThreads[0]?.lastActivityAt ?? repository.addedAt,
    threads: snapshotThreads
  }
}

function compareRepositoriesAlphabetically(
  left: Pick<RepositorySnapshot, 'name' | 'path'>,
  right: Pick<RepositorySnapshot, 'name' | 'path'>
): number {
  const byName = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  return byName !== 0
    ? byName
    : left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
}

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_WIDTH_DEFAULT
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)))
}

function buildSnapshot(options: BuildSnapshotOptions = {}): AppSnapshot {
  const state = ensureState()
  const runningThreadIds = getRunningThreadIds()
  const refreshGit = options.refreshGit ?? true

  const repositories = state.repositories
    .map((repository) =>
      buildRepositorySnapshot(repository, state.threads, runningThreadIds, refreshGit)
    )
    .sort(compareRepositoriesAlphabetically)

  return {
    repositories,
    settings: {
      ...state.settings,
      parsedGlobalFlags: parseGlobalFlags(state.settings.globalFlagsInput)
    },
    selectedRepositoryId: state.ui.selectedRepositoryId,
    selectedThreadId: state.ui.selectedThreadId,
    sidebarWidth: clampSidebarWidth(state.ui.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT)
  }
}

function buildSelectionSnapshot(): AppSnapshot {
  return buildSnapshot({ refreshGit: false })
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

function findRepository(repositoryId: string): PersistedRepository | undefined {
  return ensureState().repositories.find((repository) => repository.id === repositoryId)
}

type BaseRefResolution = { ok: true; ref: string } | { ok: false; error: string }

function resolveBaseRef(
  repoPath: string,
  useCurrentBranch: boolean | undefined
): BaseRefResolution {
  if (useCurrentBranch) {
    return { ok: true, ref: 'HEAD' }
  }

  const primary = getPrimaryBranch(repoPath)
  if (!primary) {
    return {
      ok: false,
      error:
        'Could not determine the primary branch (no origin/HEAD, main, or master found). Tick "Use current branch" to base off HEAD instead.'
    }
  }

  return { ok: true, ref: primary }
}

function createThread(input: CreateThreadInput): MutationResult {
  const state = ensureState()
  const repository = state.repositories.find((item) => item.id === input.repositoryId)

  if (!repository) {
    return failureResult('Repository not found.')
  }

  const createdAt = nowIso()
  const trimmedTitle = input.title?.trim()

  const customTitle = trimmedTitle ? trimmedTitle : null

  if (input.mode === 'worktree') {
    const branchName = input.branchName?.trim()
    if (!branchName) {
      return failureResult('Branch name is required for worktree threads.')
    }

    const baseResolution = resolveBaseRef(repository.path, input.useCurrentBranch)
    if (!baseResolution.ok) {
      return failureResult(baseResolution.error)
    }

    let worktreePath: string
    try {
      worktreePath = createWorktree(repository.path, branchName, baseResolution.ref)
    } catch (error) {
      return failureResult(error instanceof Error ? error.message : String(error))
    }

    const thread: PersistedThread = {
      id: randomUUID(),
      repositoryId: repository.id,
      customTitle,
      latestCopilotTitle: null,
      mode: 'worktree',
      branchName,
      worktreePath,
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

  if (input.mode === 'new-branch') {
    const branchName = input.branchName?.trim()
    if (!branchName) {
      return failureResult('Branch name is required for new-branch threads.')
    }

    if (branchExists(repository.path, branchName)) {
      return failureResult(`Branch "${branchName}" already exists.`)
    }

    if (hasUncommittedChanges(repository.path)) {
      return failureResult(
        'Working tree has uncommitted changes. Commit or stash them before creating a new-branch thread.'
      )
    }

    const baseResolution = resolveBaseRef(repository.path, input.useCurrentBranch)
    if (!baseResolution.ok) {
      return failureResult(baseResolution.error)
    }

    try {
      runGit(repository.path, ['checkout', '-b', branchName, baseResolution.ref])
    } catch (error) {
      return failureResult(error instanceof Error ? error.message : String(error))
    }

    const thread: PersistedThread = {
      id: randomUUID(),
      repositoryId: repository.id,
      customTitle,
      latestCopilotTitle: null,
      mode: 'new-branch',
      branchName,
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

  const currentBranch = getCurrentBranchLabel(repository.path)
  const thread: PersistedThread = {
    id: randomUUID(),
    repositoryId: repository.id,
    customTitle,
    latestCopilotTitle: null,
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
    faviconPath: null,
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
        message: `The worktree for "${thread.customTitle ?? thread.branchName}" has uncommitted changes.`,
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

function updateRepository(input: UpdateRepositoryInput): MutationResult {
  const repository = findRepository(input.repositoryId)
  if (!repository) {
    return failureResult('Repository not found.')
  }

  const validation = validateRepositoryFaviconInput(repository.path, input.faviconPath)
  if (!validation.ok) {
    return failureResult(validation.error)
  }

  if (repository.faviconPath === validation.path) {
    return successResult()
  }

  repository.faviconPath = validation.path
  saveState()
  return successResult()
}

async function pickRepositoryFavicon(
  sender: WebContents,
  repositoryId: string
): Promise<PickRepositoryFaviconResult> {
  const repository = findRepository(repositoryId)
  if (!repository) {
    return { ok: false, error: 'Repository not found.' }
  }

  const ownerWindow = BrowserWindow.fromWebContents(sender)
  const dialogOptions: OpenDialogOptions = {
    title: `Choose favicon for ${repository.name}`,
    defaultPath: join(repository.path, 'favicon.ico'),
    filters: [
      {
        name: 'Image files',
        extensions: ['bmp', 'gif', 'ico', 'jpeg', 'jpg', 'png', 'svg', 'webp']
      }
    ],
    properties: ['openFile']
  }

  const dialogResult = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { ok: false, cancelled: true }
  }

  return validateRepositoryFaviconAbsolutePath(repository.path, dialogResult.filePaths[0])
}

function updateUi(input: UpdateUiInput): MutationResult {
  const state = ensureState()
  if (typeof input.sidebarWidth === 'number') {
    state.ui.sidebarWidth = clampSidebarWidth(input.sidebarWidth)
  }
  saveState()
  return successResult()
}

function updateThreadCopilotTitle(input: UpdateThreadCopilotTitleInput): boolean {
  const thread = findThread(input.threadId)
  if (!thread) {
    return false
  }

  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    return false
  }

  if (thread.latestCopilotTitle === trimmedTitle) {
    return true
  }

  thread.latestCopilotTitle = trimmedTitle
  saveState()
  return true
}

function selectRepository(repositoryId: string | null): AppSnapshot {
  updateSelection(repositoryId, null)
  saveState()
  return buildSelectionSnapshot()
}

function selectThread(threadId: string | null): AppSnapshot {
  if (!threadId) {
    const state = ensureState()
    state.ui.selectedThreadId = null
    saveState()
    return buildSelectionSnapshot()
  }

  const thread = findThread(threadId)
  if (!thread) {
    return buildSelectionSnapshot()
  }

  updateSelection(thread.repositoryId, thread.id)
  saveState()
  return buildSelectionSnapshot()
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
  ipcMain.handle('app-state:update-repository', (_event, input: UpdateRepositoryInput) =>
    updateRepository(input)
  )
  ipcMain.handle('app-state:pick-repository-favicon', (event, repositoryId: string) =>
    pickRepositoryFavicon(event.sender, repositoryId)
  )
  ipcMain.handle('app-state:update-settings', (_event, input: UpdateSettingsInput) =>
    updateSettings(input)
  )
  ipcMain.handle('app-state:update-ui', (_event, input: UpdateUiInput) => updateUi(input))
  ipcMain.handle(
    'app-state:update-thread-copilot-title',
    (_event, input: UpdateThreadCopilotTitleInput) => updateThreadCopilotTitle(input)
  )
  ipcMain.handle('app-state:get-branch-status', (_event, input: BranchStatusRequest) =>
    getBranchStatus(input)
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
