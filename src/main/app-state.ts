import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'
import simpleGit, {
  type DiffResult,
  type DiffResultTextFile,
  type FileStatusResult,
  type SimpleGit,
  type StatusResult
} from 'simple-git'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type WebContents
} from 'electron'
import {
  type BranchStatusRequest,
  type BranchStatusSnapshot,
  type CompleteRepositoryTaskInput,
  type ProjectTaskTag,
  type OpenThreadWorkingDirectoryResult,
  type OpenThreadWorkspaceInVscodeResult,
  type PickRepositoryFaviconResult,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type AppSnapshot,
  type CreateRepositoryTaskInput,
  type CreateThreadInput,
  type MutationResult,
  type PersistedAppState,
  type PersistedProjectTask,
  type PersistedRepository,
  type PersistedThread,
  type RepositorySnapshot,
  type ThreadDiffFileStatus,
  type ThreadDiffFileSummary,
  type ThreadDiffPatchRequest,
  type ThreadDiffPatchResult,
  type ThreadDiffQuery,
  type ThreadDiffRangeOption,
  type ThreadDiffRangeOptionsResult,
  type ThreadDiffSummaryResult,
  THREAD_DIFF_WORKTREE_REF,
  type ThreadSnapshot,
  type UpdateRepositoryInput,
  type UpdateRepositoryTaskInput,
  type UpdateThreadInput,
  type UpdateThreadCopilotTitleInput,
  type UpdateThreadLastUserMessageInput,
  type UpdateThreadResumeSessionInput,
  type UpdateSettingsInput,
  type UpdateUiInput
} from '../shared/app-types'
import {
  DEFAULT_PROJECT_TASK_TAGS,
  mergeTaskTags,
  normalizeTaskTags,
  normalizeTaskTagsAgainstAllowed,
  normalizeTaskTagsInput,
  parseTaskTagsInput
} from '../shared/task-tags'
import { normalizeCopilotTitle } from '../shared/thread-title'
import {
  buildScriptCommand,
  getRunningThreadIds,
  killSessionsForThread,
  quoteCmdArgument,
  resolveCommandOnPath
} from './terminal'

const STORE_FILENAME = 'taskmaster-state.json'
const STATE_VERSION = 9 as const
const WORKTREES_DIR_SUFFIX = '.worktrees'
const BRANCH_STATUS_CACHE_TTL_MS = 1_500
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const RUN_OUTPUT_LIMIT = 24_000
const BRANCH_NAME_TOKEN = '{BRANCH-NAME}'
const BRANCH_NAME_SAFE_TOKEN = '{BRANCH-NAME-SAFE}'
const DEFAULT_TERMINAL_FONT_FAMILY =
  "'CaskaydiaCove Nerd Font Mono', 'CaskaydiaMono Nerd Font', 'MesloLGM Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'SauceCodePro Nerd Font Mono', Consolas, 'Cascadia Mono', 'Cascadia Code', 'SFMono-Regular', Menlo, Monaco, 'Geist Mono Variable', monospace"
const DEFAULT_TASK_TAGS_INPUT = DEFAULT_PROJECT_TASK_TAGS.join('\n')
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
const threadRunSessions = new Map<string, ThreadRunSession>()
let appIsQuitting = false

type ThreadRunSession = {
  threadId: string
  child: ChildProcess
  cwd: string
  command: string
  threadLabel: string
  output: string
  stopping: boolean
}

type LegacyThreadV1 = Omit<
  PersistedThread,
  'customTitle' | 'latestCopilotTitle' | 'lastUserMessage' | 'resumeSessionId'
> & {
  title: string
}
type LegacyRepositoryV8 = Omit<PersistedRepository, 'postWorktreeRemoveCommand'>
type LegacyRepositoryV7 = Omit<PersistedRepository, 'postWorktreeRemoveCommand' | 'tasks'>
type LegacyRepositoryV6 = Omit<
  PersistedRepository,
  'postWorktreeRemoveCommand' | 'runCommand' | 'tasks'
>
type LegacyAppStateV1 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 1
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV1[]
}

type LegacyThreadV2 = Omit<
  PersistedThread,
  'latestCopilotTitle' | 'lastUserMessage' | 'resumeSessionId'
>
type LegacyRepositoryV3 = Omit<
  PersistedRepository,
  'postWorktreeRemoveCommand' | 'faviconPath' | 'runCommand' | 'tasks'
>
type LegacyAppStateV3 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 3
  repositories: LegacyRepositoryV3[]
}
type LegacyAppStateV8 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 8
  repositories: LegacyRepositoryV8[]
}
type LegacyAppStateV2 = Omit<PersistedAppState, 'version' | 'threads'> & {
  version: 2
  repositories: LegacyRepositoryV3[]
  threads: LegacyThreadV2[]
}
type LegacyAppStateV6 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 6
  repositories: LegacyRepositoryV6[]
}
type LegacyAppStateV7 = Omit<PersistedAppState, 'version' | 'repositories'> & {
  version: 7
  repositories: LegacyRepositoryV7[]
}
type LegacyThreadV4 = Omit<PersistedThread, 'lastUserMessage' | 'resumeSessionId'>
type LegacyAppStateV4 = Omit<PersistedAppState, 'version' | 'threads' | 'repositories'> & {
  version: 4
  repositories: LegacyRepositoryV6[]
  threads: LegacyThreadV4[]
}
type LegacyThreadV5 = Omit<PersistedThread, 'lastUserMessage'>
type LegacyAppStateV5 = Omit<PersistedAppState, 'version' | 'threads' | 'repositories'> & {
  version: 5
  repositories: LegacyRepositoryV6[]
  threads: LegacyThreadV5[]
}

type RepositoryGitState = {
  currentBranch: string
  primaryBranch: string | null
}

type DiffProjectInfo = {
  rootPath: string
}

type RelativePathResult = { ok: true; path: string } | { ok: false; error: string }
type ParsedCommitLine = {
  fullHash: string
  shortHash: string
  subject: string
}
type ThreadGitContext =
  | {
      ok: true
      thread: PersistedThread
      repository: PersistedRepository
      cwd: string
    }
  | {
      ok: false
      error: string
    }

type BuildSnapshotOptions = {
  refreshGit?: boolean
}

function normalizePersistedThread(thread: PersistedThread): PersistedThread {
  const latestCopilotTitle = normalizeCopilotTitle(thread, thread.latestCopilotTitle)
  const lastUserMessage = normalizeTrackedText(thread.lastUserMessage ?? null)
  return latestCopilotTitle === thread.latestCopilotTitle &&
    lastUserMessage === thread.lastUserMessage
    ? thread
    : {
        ...thread,
        latestCopilotTitle,
        lastUserMessage
      }
}

function normalizeTrackedText(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeTaskTitle(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeTaskDescription(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function sameTaskTags(left: readonly ProjectTaskTag[], right: readonly ProjectTaskTag[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

function normalizePersistedTask(task: PersistedProjectTask): PersistedProjectTask {
  const title = normalizeTaskTitle(task.title) ?? 'Untitled task'
  const description = normalizeTaskDescription(task.description) ?? ''
  const currentTags = Array.isArray(task.tags) ? task.tags : []
  const tags = normalizeTaskTags(currentTags)

  return title === task.title &&
    description === task.description &&
    Array.isArray(task.tags) &&
    sameTaskTags(tags, currentTags)
    ? task
    : {
        ...task,
        title,
        description,
        tags
      }
}

function normalizeRunCommand(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeRepositoryScript(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizePersistedRepository(repository: PersistedRepository): PersistedRepository {
  const runCommand = normalizeRunCommand(repository.runCommand)
  const postWorktreeRemoveCommand = normalizeRepositoryScript(repository.postWorktreeRemoveCommand)
  const currentTasks = Array.isArray(repository.tasks) ? repository.tasks : []
  const tasks = currentTasks.map((task) => normalizePersistedTask(task))
  return runCommand === repository.runCommand &&
    postWorktreeRemoveCommand === repository.postWorktreeRemoveCommand &&
    Array.isArray(repository.tasks) &&
    tasks.length === currentTasks.length &&
    tasks.every((task, index) => task === currentTasks[index])
    ? repository
    : {
        ...repository,
        runCommand,
        postWorktreeRemoveCommand,
        tasks
      }
}

function normalizeTerminalFontFamilyInput(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function normalizePersistedSettings(
  settings: PersistedAppState['settings']
): PersistedAppState['settings'] {
  const terminalFontFamilyInput = normalizeTerminalFontFamilyInput(settings.terminalFontFamilyInput)
  const currentTaskTagsInput =
    typeof (settings as { taskTagsInput?: unknown }).taskTagsInput === 'string'
      ? (settings as { taskTagsInput: string }).taskTagsInput
      : undefined
  const taskTagsInput =
    currentTaskTagsInput === undefined
      ? DEFAULT_TASK_TAGS_INPUT
      : normalizeTaskTagsInput(currentTaskTagsInput)

  return terminalFontFamilyInput === settings.terminalFontFamilyInput &&
    taskTagsInput === currentTaskTagsInput
    ? settings
    : {
        ...settings,
        terminalFontFamilyInput,
        taskTagsInput
      }
}

function resolveTerminalFontFamily(settings: PersistedAppState['settings']): string {
  return (
    normalizeTerminalFontFamilyInput(settings.terminalFontFamilyInput) ||
    DEFAULT_TERMINAL_FONT_FAMILY
  )
}

function normalizePersistedState(state: PersistedAppState): PersistedAppState {
  const settings = normalizePersistedSettings(state.settings)
  let didChange = settings !== state.settings
  const repositories = state.repositories.map((repository) => {
    const normalizedRepository = normalizePersistedRepository(repository)
    if (normalizedRepository !== repository) {
      didChange = true
    }
    return normalizedRepository
  })
  const threads = state.threads.map((thread) => {
    const normalizedThread = normalizePersistedThread(thread)
    if (normalizedThread !== thread) {
      didChange = true
    }
    return normalizedThread
  })

  return didChange
    ? {
        ...state,
        settings,
        repositories,
        threads
      }
    : state
}

function migrateState(
  parsed:
    | PersistedAppState
    | LegacyAppStateV8
    | LegacyAppStateV7
    | LegacyAppStateV6
    | LegacyAppStateV5
    | LegacyAppStateV4
    | LegacyAppStateV3
    | LegacyAppStateV2
    | LegacyAppStateV1
): PersistedAppState {
  if (parsed.version === STATE_VERSION) {
    return normalizePersistedState(parsed)
  }

  if (parsed.version === 8) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: parsed.repositories.map((repository) => ({
        ...repository,
        postWorktreeRemoveCommand: null
      }))
    })
  }

  if (parsed.version === 7) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: parsed.repositories.map((repository) => ({
        ...repository,
        postWorktreeRemoveCommand: null,
        tasks: []
      }))
    })
  }

  if (parsed.version === 5) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: parsed.repositories.map((repository) => ({
        ...repository,
        runCommand: null,
        postWorktreeRemoveCommand: null,
        tasks: []
      })),
      threads: parsed.threads.map((thread) => ({
        ...thread,
        lastUserMessage: null
      }))
    })
  }

  if (parsed.version === 4) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: parsed.repositories.map((repository) => ({
        ...repository,
        runCommand: null,
        postWorktreeRemoveCommand: null,
        tasks: []
      })),
      threads: parsed.threads.map((thread) => ({
        ...thread,
        lastUserMessage: null,
        resumeSessionId: null
      }))
    })
  }

  const migratedRepositories = parsed.repositories.map((repository) => ({
    ...repository,
    faviconPath: null,
    runCommand: null,
    postWorktreeRemoveCommand: null,
    tasks: []
  }))

  if (parsed.version === 6) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: parsed.repositories.map((repository) => ({
        ...repository,
        runCommand: null,
        postWorktreeRemoveCommand: null,
        tasks: []
      }))
    })
  }

  if (parsed.version === 3) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories
    })
  }

  if (parsed.version === 2) {
    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: parsed.threads.map((thread) => ({
        ...thread,
        latestCopilotTitle: null,
        lastUserMessage: null,
        resumeSessionId: null
      }))
    })
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
        latestCopilotTitle: null,
        lastUserMessage: null,
        resumeSessionId: null
      }
    })

    return normalizePersistedState({
      ...parsed,
      version: STATE_VERSION,
      repositories: migratedRepositories,
      threads: migratedThreads
    })
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
      globalFlagsInput: '',
      terminalFontFamilyInput: '',
      taskTagsInput: DEFAULT_TASK_TAGS_INPUT
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
    | LegacyAppStateV7
    | LegacyAppStateV6
    | LegacyAppStateV5
    | LegacyAppStateV4
    | LegacyAppStateV3
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

function resolveRepositoryAssetPath(
  repositoryPath: string,
  relativePath: string | null
): string | null {
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

function buildRepositoryFaviconUrl(
  repositoryPath: string,
  relativePath: string | null
): string | null {
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

function validateRepositoryRunCommandInput(input: string | null): {
  ok: true
  command: string | null
} {
  return {
    ok: true,
    command: normalizeRunCommand(input)
  }
}

function validateRepositoryPostWorktreeRemoveCommandInput(input: string | null): {
  ok: true
  command: string | null
} {
  return {
    ok: true,
    command: normalizeRepositoryScript(input)
  }
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

function getGitClient(cwd: string): SimpleGit {
  return simpleGit(cwd)
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

function sanitizeBranchTokenValue(branchName: string): string {
  const normalized = branchName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  return normalized || 'branch'
}

function applyThreadBranchTokens(
  command: string,
  thread: Pick<PersistedThread, 'branchName'>
): string {
  return command
    .split(BRANCH_NAME_SAFE_TOKEN)
    .join(sanitizeBranchTokenValue(thread.branchName))
    .split(BRANCH_NAME_TOKEN)
    .join(thread.branchName)
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

function remoteBranchExists(repoPath: string, branchName: string): boolean {
  const result = tryGit(repoPath, ['branch', '--remotes', '--list', `*/${branchName}`])
  return result.ok && result.stdout.length > 0
}

function getCurrentBranchName(repoPath: string): string | null {
  const branchResult = tryGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!branchResult.ok || branchResult.stdout === 'HEAD') {
    return null
  }

  return branchResult.stdout
}

function getPrimaryBranchCheckoutTarget(repoPath: string, branchName: string): string | null {
  const primaryBranch = getPrimaryBranch(repoPath)
  return primaryBranch && primaryBranch !== branchName ? primaryBranch : null
}

function getProtectedBranchDeletionError(repoPath: string, branchName: string): string | null {
  if (branchName === 'main') {
    return 'The main branch cannot be deleted.'
  }

  const primaryBranch = getPrimaryBranch(repoPath)
  if (primaryBranch === branchName) {
    return `The repository primary branch "${branchName}" cannot be deleted.`
  }

  return null
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

function resolveThreadGitContext(threadId: string): ThreadGitContext {
  const thread = findThread(threadId)
  if (!thread) {
    return { ok: false, error: 'Thread not found.' }
  }

  const repository = findRepository(thread.repositoryId)
  if (!repository) {
    return { ok: false, error: 'Repository not found.' }
  }

  return {
    ok: true,
    thread,
    repository,
    cwd: getThreadCwd(thread, repository.path)
  }
}

async function openThreadWorkingDirectory(
  threadId: string
): Promise<OpenThreadWorkingDirectoryResult> {
  const context = resolveThreadGitContext(threadId)
  if (!context.ok) {
    return { ok: false, error: context.error }
  }

  const { cwd } = context
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return { ok: false, error: `Working directory not found: ${cwd}` }
  }

  const error = await shell.openPath(cwd)
  return error ? { ok: false, error: `Failed to open working directory: ${error}` } : { ok: true }
}

function buildVscodeWorkspaceUri(cwd: string): string {
  return `vscode://file${pathToFileURL(cwd).pathname}`
}

function buildVscodeLaunchCommand(
  commandPath: string,
  cwd: string
): { file: string; args: string[] } {
  const vscodeArgs = ['-n', cwd]

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)) {
    const command = [quoteCmdArgument(commandPath), ...vscodeArgs.map(quoteCmdArgument)].join(' ')
    return {
      file: process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', command]
    }
  }

  return { file: commandPath, args: vscodeArgs }
}

function spawnDetachedProcess(
  command: { file: string; args: string[] },
  cwd: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'ignore'
    })

    const handleError = (error: Error): void => reject(error)
    const handleSpawn = (): void => {
      child.off('error', handleError)
      child.unref()
      resolve()
    }

    child.once('error', handleError)
    child.once('spawn', handleSpawn)
  })
}

async function openThreadWorkspaceInVscode(
  threadId: string
): Promise<OpenThreadWorkspaceInVscodeResult> {
  const context = resolveThreadGitContext(threadId)
  if (!context.ok) {
    return { ok: false, error: context.error }
  }

  const { cwd } = context
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return { ok: false, error: `Working directory not found: ${cwd}` }
  }

  try {
    await shell.openExternal(buildVscodeWorkspaceUri(cwd))
    return { ok: true }
  } catch (uriError) {
    const codePath = resolveCommandOnPath('code')
    if (codePath) {
      try {
        const command = buildVscodeLaunchCommand(codePath, cwd)
        await spawnDetachedProcess(command, cwd)
        return { ok: true }
      } catch (cliError) {
        return {
          ok: false,
          error: `Failed to open workspace in VS Code: ${
            cliError instanceof Error ? cliError.message : String(cliError)
          }`
        }
      }
    }

    return {
      ok: false,
      error:
        uriError instanceof Error
          ? `VS Code is unavailable: ${uriError.message}`
          : `VS Code is unavailable: ${String(uriError)}`
    }
  }
}

function appendThreadRunOutput(session: ThreadRunSession, chunk: string | Buffer): void {
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  if (!text) {
    return
  }

  session.output = `${session.output}${text}`.slice(-RUN_OUTPUT_LIMIT)
}

function formatThreadRunFailureDetail(
  session: Pick<ThreadRunSession, 'command' | 'cwd' | 'output'>,
  fallbackMessage: string | null = null
): string {
  const sections = [`Command:\n${session.command}`, `Working directory:\n${session.cwd}`]
  const output = session.output.trim()
  if (output) {
    sections.push(`Output:\n${output}`)
  } else if (fallbackMessage) {
    sections.push(`Details:\n${fallbackMessage}`)
  }
  return sections.join('\n\n')
}

async function showThreadRunFailureDialog(
  title: string,
  message: string,
  detail: string
): Promise<void> {
  const ownerWindow =
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ??
    null

  const options = {
    type: 'error' as const,
    buttons: ['OK'],
    defaultId: 0,
    title,
    message,
    detail,
    noLink: true
  }

  if (ownerWindow) {
    await dialog.showMessageBox(ownerWindow, options)
    return
  }

  await dialog.showMessageBox(options)
}

function broadcastThreadRunState(threadId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    window.webContents.send('app-state:thread-run-state', { threadId })
  }
}

function killChildProcessTree(child: Pick<ChildProcess, 'pid'>): void {
  if (!child.pid) {
    return
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    return
  }

  try {
    process.kill(-child.pid, 'SIGTERM')
    return
  } catch {
    // Fall through to direct child kill.
  }

  try {
    process.kill(child.pid, 'SIGTERM')
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

function stopThreadRunSession(threadId: string): boolean {
  const session = threadRunSessions.get(threadId)
  if (!session) {
    return false
  }

  session.stopping = true
  threadRunSessions.delete(threadId)
  broadcastThreadRunState(threadId)
  killChildProcessTree(session.child)
  return true
}

function finalizeThreadRun(
  threadId: string,
  result: { exitCode?: number | null; error?: Error | string | null } = {}
): void {
  const session = threadRunSessions.get(threadId)
  if (!session) {
    return
  }

  threadRunSessions.delete(threadId)
  broadcastThreadRunState(threadId)

  if (session.stopping || appIsQuitting) {
    return
  }

  if (result.error) {
    const detail = formatThreadRunFailureDetail(
      session,
      result.error instanceof Error ? result.error.message : String(result.error)
    )
    void showThreadRunFailureDialog(
      'Run command failed',
      `${session.threadLabel} failed to start.`,
      detail
    )
    return
  }

  if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    const detail = formatThreadRunFailureDetail(
      session,
      `Process exited with code ${result.exitCode}.`
    )
    void showThreadRunFailureDialog(
      'Run command failed',
      `${session.threadLabel} exited with code ${result.exitCode}.`,
      detail
    )
  }
}

function startThreadRun(threadId: string): MutationResult {
  if (threadRunSessions.has(threadId)) {
    return failureResult('Run command already active for this thread.')
  }

  const context = resolveThreadGitContext(threadId)
  if (!context.ok) {
    return failureResult(context.error)
  }

  const runCommand = normalizeRunCommand(context.repository.runCommand)
  if (!runCommand) {
    return failureResult('No run command configured for this project.')
  }

  if (!existsSync(context.cwd) || !statSync(context.cwd).isDirectory()) {
    return failureResult(`Working directory not found: ${context.cwd}`)
  }

  const resolvedRunCommand = applyThreadBranchTokens(runCommand, context.thread)
  const command = buildScriptCommand(resolvedRunCommand)

  try {
    const child = spawn(command.file, command.args, {
      cwd: context.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const session: ThreadRunSession = {
      threadId,
      child,
      cwd: context.cwd,
      command: resolvedRunCommand,
      threadLabel: context.thread.customTitle ?? context.thread.branchName,
      output: '',
      stopping: false
    }

    threadRunSessions.set(threadId, session)
    child.stdout.on('data', (chunk) => appendThreadRunOutput(session, chunk))
    child.stderr.on('data', (chunk) => appendThreadRunOutput(session, chunk))
    child.once('error', (error) => finalizeThreadRun(threadId, { error }))
    child.once('exit', (exitCode) => finalizeThreadRun(threadId, { exitCode }))

    broadcastThreadRunState(threadId)
    return successResult()
  } catch (error) {
    return failureResult(error instanceof Error ? error.message : String(error))
  }
}

function stopThreadRun(threadId: string): MutationResult {
  const thread = findThread(threadId)
  if (!thread) {
    return failureResult('Thread not found.')
  }

  stopThreadRunSession(threadId)
  return successResult()
}

function removeWorktree(thread: PersistedThread, repositoryPath: string, force: boolean): void {
  const protectedBranchError = getProtectedBranchDeletionError(repositoryPath, thread.branchName)
  if (protectedBranchError) {
    throw new Error(protectedBranchError)
  }

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

function runPostWorktreeRemoveCommand(
  repository: Pick<PersistedRepository, 'path' | 'postWorktreeRemoveCommand'>,
  thread: Pick<PersistedThread, 'branchName'>
): void {
  const script = normalizeRepositoryScript(repository.postWorktreeRemoveCommand)
  if (!script) {
    return
  }

  const resolvedScript = applyThreadBranchTokens(script, thread)
  const command = buildScriptCommand(resolvedScript)
  const result = spawnSync(command.file, command.args, {
    cwd: repository.path,
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `Script exited with code ${result.status ?? 'unknown'}.`
    throw new Error(detail)
  }
}

async function maybeRemoveLocalBranchForNewBranchThread(
  thread: PersistedThread,
  repositoryPath: string
): Promise<MutationResult | null> {
  if (
    !branchExists(repositoryPath, thread.branchName) ||
    remoteBranchExists(repositoryPath, thread.branchName)
  ) {
    return null
  }

  const threadLabel = thread.customTitle ?? thread.branchName
  const confirmation = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Keep branch', 'Remove branch'],
    defaultId: 2,
    cancelId: 0,
    title: 'Remove local branch?',
    message: `Close "${threadLabel}" and remove its local branch?`,
    detail: `The remote branch "${thread.branchName}" no longer exists. Keep branch will only remove the thread.`
  })

  if (confirmation.response === 0) {
    return failureResult('Thread close cancelled.', true)
  }

  if (confirmation.response === 1 || !branchExists(repositoryPath, thread.branchName)) {
    return null
  }

  const protectedBranchError = getProtectedBranchDeletionError(repositoryPath, thread.branchName)
  if (protectedBranchError) {
    return failureResult(protectedBranchError)
  }

  const currentBranchName = getCurrentBranchName(repositoryPath)
  if (currentBranchName === thread.branchName) {
    if (isDirtyGitPath(repositoryPath)) {
      const dirtyConfirmation = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['Cancel thread removal', 'Continue without removing branch'],
        defaultId: 0,
        cancelId: 0,
        title: 'Cannot delete branch',
        message: `Can't delete "${thread.branchName}" because it is checked out and has uncommitted changes.`,
        detail:
          'Taskmaster cannot switch to the primary branch until you commit or stash those changes.'
      })

      if (dirtyConfirmation.response === 0) {
        return failureResult('Thread close cancelled.', true)
      }

      return null
    }

    const checkoutTarget = getPrimaryBranchCheckoutTarget(repositoryPath, thread.branchName)
    if (!checkoutTarget) {
      return failureResult(
        `Can't delete "${thread.branchName}" because the repository primary branch could not be determined.`
      )
    }

    try {
      runGit(repositoryPath, ['checkout', checkoutTarget])
    } catch (error) {
      return failureResult(error instanceof Error ? error.message : String(error))
    }
  }

  if (!branchExists(repositoryPath, thread.branchName)) {
    return null
  }

  try {
    runGit(repositoryPath, ['branch', '-D', thread.branchName])
  } catch (error) {
    return failureResult(error instanceof Error ? error.message : String(error))
  }

  return null
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

function hasHeadCommit(cwd: string): boolean {
  return tryGit(cwd, ['rev-parse', '--verify', 'HEAD']).ok
}

function getWorkingTreeDiffBase(cwd: string): string {
  return hasHeadCommit(cwd) ? 'HEAD' : EMPTY_TREE_HASH
}

function isWorkingTreeRef(ref: string | null | undefined): boolean {
  return (ref?.trim() ?? '') === THREAD_DIFF_WORKTREE_REF
}

function parseCommitLines(stdout: string): ParsedCommitLine[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [fullHash = '', shortHash = '', subject = ''] = line.split('\u001f')
      return {
        fullHash,
        shortHash,
        subject
      }
    })
    .filter((commit) => commit.fullHash.length > 0)
}

function buildCommitOption(commit: ParsedCommitLine, labelPrefix?: string): ThreadDiffRangeOption {
  const subject = commit.subject || '(no subject)'
  return {
    value: commit.fullHash,
    label: labelPrefix
      ? `${labelPrefix}: ${subject} (${commit.shortHash})`
      : `${subject} (${commit.shortHash})`,
    description: commit.fullHash
  }
}

async function readCommitOption(
  cwd: string,
  ref: string,
  labelPrefix?: string
): Promise<ThreadDiffRangeOption> {
  const result = await tryGitAsync(cwd, ['show', '-s', '--format=%H%x1f%h%x1f%s', ref])
  if (!result.ok) {
    throw new Error(result.stderr || `Unable to read commit ${ref}.`)
  }

  const commit = parseCommitLines(result.stdout)[0]
  if (!commit) {
    throw new Error(`Unable to read commit ${ref}.`)
  }

  return buildCommitOption(commit, labelPrefix)
}

function buildUntrackedDiffFiles(status: StatusResult): ThreadDiffFileSummary[] {
  return status.files
    .filter((file) => resolveWorkingTreeFileStatus(file, new Map()) === 'untracked')
    .map((file) => ({
      path: file.path,
      previousPath: null,
      projectRootPath: null,
      previousProjectRootPath: null,
      status: 'untracked' as const,
      additions: null,
      deletions: null,
      isBinary: false
    }))
}

function normalizeDiffStatPath(path: string): string {
  const braceRename = /^(.*)\{([^{}]+?) => ([^{}]+?)\}(.*)$/.exec(path)
  if (braceRename) {
    return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`
  }

  const arrowIndex = path.lastIndexOf(' => ')
  return arrowIndex >= 0 ? path.slice(arrowIndex + 4) : path
}

function buildDiffStatMap(result: DiffResult): Map<string, DiffResultTextFile> {
  const stats = new Map<string, DiffResultTextFile>()

  for (const file of result.files) {
    if (file.binary) {
      continue
    }

    stats.set(normalizeDiffStatPath(file.file), file)
  }

  return stats
}

function mapStatusTokenToDiffStatus(token: string): ThreadDiffFileStatus {
  switch (token[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'conflicted'
    case 'T':
      return 'typechange'
    default:
      return 'modified'
  }
}

function parseNameStatusOutput(
  stdout: string,
  stats: Map<string, DiffResultTextFile>
): ThreadDiffFileSummary[] {
  const files: ThreadDiffFileSummary[] = []
  const tokens = stdout.split('\0')

  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index++]
    if (!statusToken) {
      continue
    }

    const status = mapStatusTokenToDiffStatus(statusToken)
    if (status === 'renamed' || status === 'copied') {
      const previousPath = tokens[index++] ?? ''
      const path = tokens[index++] ?? ''
      if (!path) {
        continue
      }

      const stat = stats.get(path) ?? null
      files.push({
        path,
        previousPath: previousPath || null,
        projectRootPath: null,
        previousProjectRootPath: null,
        status,
        additions: stat?.insertions ?? null,
        deletions: stat?.deletions ?? null,
        isBinary: false
      })
      continue
    }

    const path = tokens[index++] ?? ''
    if (!path) {
      continue
    }

    const stat = stats.get(path) ?? null
    files.push({
      path,
      previousPath: null,
      projectRootPath: null,
      previousProjectRootPath: null,
      status,
      additions: stat?.insertions ?? null,
      deletions: stat?.deletions ?? null,
      isBinary: false
    })
  }

  return files.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  )
}

function resolveWorkingTreeFileStatus(
  file: FileStatusResult,
  renamedByPath: Map<string, string>
): ThreadDiffFileStatus {
  if (file.index === 'U' || file.working_dir === 'U') {
    return 'conflicted'
  }

  if (file.index === '?' || file.working_dir === '?') {
    return 'untracked'
  }

  if (file.index === 'T' || file.working_dir === 'T') {
    return 'typechange'
  }

  if (file.index === 'D' || file.working_dir === 'D') {
    return 'deleted'
  }

  if (file.index === 'A' || file.working_dir === 'A') {
    return 'added'
  }

  if (file.index === 'C' || file.working_dir === 'C') {
    return 'copied'
  }

  if (file.index === 'R' || file.working_dir === 'R' || renamedByPath.has(file.path)) {
    return 'renamed'
  }

  return 'modified'
}

function buildWorkingTreeDiffFiles(
  status: StatusResult,
  stats: Map<string, DiffResultTextFile>
): ThreadDiffFileSummary[] {
  const renamedByPath = new Map(status.renamed.map((entry) => [entry.to, entry.from]))

  return status.files
    .map((file) => {
      const stat = stats.get(file.path) ?? null
      const diffStatus = resolveWorkingTreeFileStatus(file, renamedByPath)
      return {
        path: file.path,
        previousPath: file.from ?? renamedByPath.get(file.path) ?? null,
        projectRootPath: null,
        previousProjectRootPath: null,
        status: diffStatus,
        additions: stat?.insertions ?? null,
        deletions: stat?.deletions ?? null,
        isBinary: false
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }))
}

function normalizeDiffProjectPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function directoryContainsProjectMarker(path: string): boolean {
  if (!existsSync(path)) {
    return false
  }

  if (existsSync(join(path, 'package.json'))) {
    return true
  }

  return readdirSync(path, { withFileTypes: true }).some(
    (entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.csproj'
  )
}

function findDiffProjectForPath(
  cwd: string,
  relativePath: string,
  cache: Map<string, DiffProjectInfo | null>
): DiffProjectInfo | null {
  const normalizedCwd = normalize(cwd)
  let currentDirectory = dirname(resolve(cwd, relativePath))
  const visitedDirectories: string[] = []

  while (true) {
    const normalizedDirectory = normalize(currentDirectory)
    if (
      normalizedDirectory !== normalizedCwd &&
      !isPathInsideRepository(cwd, normalizedDirectory)
    ) {
      break
    }

    const cached = cache.get(normalizedDirectory)
    if (cached !== undefined) {
      for (const directory of visitedDirectories) {
        cache.set(directory, cached)
      }
      return cached
    }

    visitedDirectories.push(normalizedDirectory)
    if (directoryContainsProjectMarker(normalizedDirectory)) {
      const project = {
        rootPath: normalizeDiffProjectPath(relative(cwd, normalizedDirectory))
      }
      for (const directory of visitedDirectories) {
        cache.set(directory, project)
      }
      return project
    }

    if (normalizedDirectory === normalizedCwd) {
      break
    }

    const parentDirectory = dirname(normalizedDirectory)
    if (parentDirectory === normalizedDirectory) {
      break
    }

    currentDirectory = parentDirectory
  }

  for (const directory of visitedDirectories) {
    cache.set(directory, null)
  }

  return null
}

function annotateDiffFilesWithProjects(
  cwd: string,
  files: ThreadDiffFileSummary[]
): ThreadDiffFileSummary[] {
  const projectCache = new Map<string, DiffProjectInfo | null>()

  return files.map((file) => {
    const project = findDiffProjectForPath(cwd, file.path, projectCache)
    const previousProject =
      file.previousPath === null
        ? null
        : findDiffProjectForPath(cwd, file.previousPath, projectCache)

    return {
      ...file,
      projectRootPath: project?.rootPath ?? null,
      previousProjectRootPath: previousProject?.rootPath ?? null
    }
  })
}

async function getThreadDiffRangeOptions(threadId: string): Promise<ThreadDiffRangeOptionsResult> {
  const context = resolveThreadGitContext(threadId)
  if (!context.ok) {
    return { ok: false, error: context.error }
  }

  const { cwd } = context
  if (!hasHeadCommit(cwd)) {
    return { ok: false, error: 'No commits exist on this branch yet.' }
  }

  try {
    const currentBranch = getCurrentBranchName(cwd)
    const primaryBranch = getPrimaryBranch(cwd)

    let defaultBaseRef = ''
    if (currentBranch && primaryBranch && currentBranch !== primaryBranch) {
      const mergeBase = tryGit(cwd, ['merge-base', primaryBranch, 'HEAD'])
      if (mergeBase.ok && mergeBase.stdout) {
        defaultBaseRef = mergeBase.stdout
      }
    }

    if (!defaultBaseRef) {
      const rootCommit = tryGit(cwd, ['rev-list', '--max-parents=0', 'HEAD'])
      defaultBaseRef = rootCommit.stdout.split(/\r?\n/)[0] ?? ''
    }

    if (!defaultBaseRef) {
      return { ok: false, error: 'Unable to determine a branch base commit.' }
    }

    const baseOption = await readCommitOption(cwd, defaultBaseRef, 'Branch base')
    const history = await tryGitAsync(cwd, [
      'log',
      '--reverse',
      '--format=%H%x1f%h%x1f%s',
      `${defaultBaseRef}..HEAD`
    ])
    if (!history.ok) {
      return { ok: false, error: history.stderr || 'Unable to read current branch history.' }
    }

    const commitOptions = [
      baseOption,
      ...parseCommitLines(history.stdout).map((commit) => buildCommitOption(commit))
    ]

    return {
      ok: true,
      options: {
        baseOptions: commitOptions,
        headOptions: [
          ...commitOptions,
          {
            value: THREAD_DIFF_WORKTREE_REF,
            label: 'Current changes',
            description: 'Working tree state on top of HEAD'
          }
        ],
        defaultBaseRef,
        defaultHeadRef: THREAD_DIFF_WORKTREE_REF
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function getRangeToWorkingTreeDiffFiles(
  git: SimpleGit,
  baseRef: string
): Promise<ThreadDiffFileSummary[]> {
  const [nameStatus, diffSummary, status] = await Promise.all([
    git.raw(['diff', '--name-status', '-z', '--find-renames', baseRef]),
    git.diffSummary([baseRef]),
    git.status()
  ])

  const trackedFiles = parseNameStatusOutput(nameStatus, buildDiffStatMap(diffSummary))
  const trackedByPath = new Set(trackedFiles.map((file) => file.path))
  const untrackedFiles = buildUntrackedDiffFiles(status).filter(
    (file) => !trackedByPath.has(file.path)
  )

  return [...trackedFiles, ...untrackedFiles].sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  )
}

async function getThreadDiffSummary(input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> {
  const context = resolveThreadGitContext(input.threadId)
  if (!context.ok) {
    return { ok: false, error: context.error }
  }

  const { cwd } = context
  const git = getGitClient(cwd)

  try {
    if (input.mode === 'range') {
      const baseRef = input.baseRef?.trim() ?? ''
      const headRef = input.headRef?.trim() ?? ''
      if (!baseRef || !headRef) {
        return { ok: false, error: 'Both range refs are required.' }
      }

      if (isWorkingTreeRef(baseRef)) {
        return { ok: false, error: 'Base ref must be a commit.' }
      }

      if (isWorkingTreeRef(headRef)) {
        return {
          ok: true,
          summary: {
            mode: input.mode,
            baseRef,
            headRef,
            files: annotateDiffFilesWithProjects(
              cwd,
              await getRangeToWorkingTreeDiffFiles(git, baseRef)
            )
          }
        }
      }

      const [nameStatus, diffSummary] = await Promise.all([
        git.raw(['diff', '--name-status', '-z', '--find-renames', baseRef, headRef]),
        git.diffSummary([baseRef, headRef])
      ])

      return {
        ok: true,
        summary: {
          mode: input.mode,
          baseRef,
          headRef,
          files: annotateDiffFilesWithProjects(
            cwd,
            parseNameStatusOutput(nameStatus, buildDiffStatMap(diffSummary))
          )
        }
      }
    }

    const diffBase = getWorkingTreeDiffBase(cwd)
    const [status, diffSummary] = await Promise.all([git.status(), git.diffSummary([diffBase])])

    return {
      ok: true,
      summary: {
        mode: input.mode,
        baseRef: null,
        headRef: null,
        files: annotateDiffFilesWithProjects(
          cwd,
          buildWorkingTreeDiffFiles(status, buildDiffStatMap(diffSummary))
        )
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function buildUntrackedFilePatch(cwd: string, path: string): Promise<ThreadDiffPatchResult> {
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const result = await tryGitAsync(cwd, ['diff', '--no-index', '--binary', '--', nullPath, path])
  if (result.stdout.trim().length > 0) {
    return { ok: true, patch: result.stdout, isBinary: false }
  }

  return {
    ok: false,
    error: result.stderr || `Unable to build a patch for "${path}".`
  }
}

async function getThreadDiffPatch(input: ThreadDiffPatchRequest): Promise<ThreadDiffPatchResult> {
  const context = resolveThreadGitContext(input.threadId)
  if (!context.ok) {
    return { ok: false, error: context.error }
  }

  const { cwd } = context
  const trimmedPath = input.path.trim()
  if (!trimmedPath) {
    return { ok: false, error: 'Diff path is required.' }
  }

  const resolvedPath = resolve(cwd, trimmedPath)
  if (!isPathInsideRepository(cwd, resolvedPath)) {
    return { ok: false, error: 'Diff path must stay inside the thread working directory.' }
  }

  if (input.status === 'untracked') {
    return buildUntrackedFilePatch(cwd, trimmedPath)
  }

  const git = getGitClient(cwd)
  const previousPath = input.previousPath?.trim() ?? ''
  const pathspec =
    previousPath && previousPath !== trimmedPath ? [previousPath, trimmedPath] : [trimmedPath]

  try {
    const baseRef = input.baseRef?.trim() ?? ''
    const headRef = input.headRef?.trim() ?? ''
    if (input.mode === 'range' && (!baseRef || !headRef)) {
      return { ok: false, error: 'Both range refs are required.' }
    }
    if (input.mode === 'range' && isWorkingTreeRef(baseRef)) {
      return { ok: false, error: 'Base ref must be a commit.' }
    }

    const patch =
      input.mode === 'range'
        ? isWorkingTreeRef(headRef)
          ? await git.raw([
              'diff',
              '--patch',
              '--binary',
              '--find-renames',
              baseRef,
              '--',
              ...pathspec
            ])
          : await git.raw([
              'diff',
              '--patch',
              '--binary',
              '--find-renames',
              baseRef,
              headRef,
              '--',
              ...pathspec
            ])
        : await git.raw([
            'diff',
            '--patch',
            '--binary',
            '--find-renames',
            getWorkingTreeDiffBase(cwd),
            '--',
            ...pathspec
          ])

    return {
      ok: true,
      patch,
      isBinary: patch.includes('GIT binary patch') || patch.includes('Binary files')
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
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
  runningRunThreadIds: Set<string>
): ThreadSnapshot {
  return {
    ...thread,
    cwd: getThreadCwd(thread, repository.path),
    displayBranchName: thread.branchName,
    displayTitle: thread.customTitle ?? thread.branchName,
    isRunning: runningThreadIds.has(thread.id),
    isRunCommandRunning: runningRunThreadIds.has(thread.id)
  }
}

function buildRepositorySnapshot(
  repository: PersistedRepository,
  threads: PersistedThread[],
  runningThreadIds: Set<string>,
  runningRunThreadIds: Set<string>,
  refreshGit: boolean
): RepositorySnapshot {
  const repositoryGitState = getRepositoryGitState(repository, refreshGit)
  const snapshotThreads = threads
    .filter((thread) => thread.repositoryId === repository.id)
    .map((thread) => buildThreadSnapshot(repository, thread, runningThreadIds, runningRunThreadIds))
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
  const runningRunThreadIds = new Set(threadRunSessions.keys())
  const refreshGit = options.refreshGit ?? true

  const repositories = state.repositories
    .map((repository) =>
      buildRepositorySnapshot(
        repository,
        state.threads,
        runningThreadIds,
        runningRunThreadIds,
        refreshGit
      )
    )
    .sort(compareRepositoriesAlphabetically)

  return {
    repositories,
    settings: {
      ...state.settings,
      parsedGlobalFlags: parseGlobalFlags(state.settings.globalFlagsInput),
      parsedTaskTags: parseTaskTagsInput(state.settings.taskTagsInput),
      resolvedTerminalFontFamily: resolveTerminalFontFamily(state.settings)
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

function normalizeCustomTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  return trimmedTitle ? trimmedTitle : null
}

function sanitizeSessionNamePrefix(repositoryName: string): string {
  const sanitized = repositoryName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'thread'
}

function buildThreadSessionName(repository: Pick<PersistedRepository, 'name'>): string {
  return `${sanitizeSessionNamePrefix(repository.name)}-${randomUUID()}`
}

function validateRepositoryTaskValues(input: {
  title: string
  description: string
  tags: ProjectTaskTag[]
  allowedTags: readonly ProjectTaskTag[]
}):
  | {
      ok: true
      title: string
      description: string
      tags: ProjectTaskTag[]
    }
  | {
      ok: false
      error: string
    } {
  const title = normalizeTaskTitle(input.title)
  if (!title) {
    return { ok: false, error: 'Task title is required.' }
  }

  const description = normalizeTaskDescription(input.description)
  if (!description) {
    return { ok: false, error: 'Task description is required.' }
  }

  return {
    ok: true,
    title,
    description,
    tags: normalizeTaskTagsAgainstAllowed(input.tags, input.allowedTags)
  }
}

function createRepositoryTask(input: CreateRepositoryTaskInput): MutationResult {
  const repository = findRepository(input.repositoryId)
  if (!repository) {
    return failureResult('Repository not found.')
  }

  const validation = validateRepositoryTaskValues({
    ...input,
    allowedTags: parseTaskTagsInput(ensureState().settings.taskTagsInput)
  })
  if (!validation.ok) {
    return failureResult(validation.error)
  }

  const task: PersistedProjectTask = {
    id: randomUUID(),
    title: validation.title,
    description: validation.description,
    tags: validation.tags,
    createdAt: nowIso()
  }

  repository.tasks = [task, ...(repository.tasks ?? [])]
  saveState()
  return successResult()
}

function updateRepositoryTask(input: UpdateRepositoryTaskInput): MutationResult {
  const repository = findRepository(input.repositoryId)
  if (!repository) {
    return failureResult('Repository not found.')
  }

  const task = (repository.tasks ?? []).find((item) => item.id === input.taskId)
  if (!task) {
    return failureResult('Task not found.')
  }

  const validation = validateRepositoryTaskValues({
    ...input,
    allowedTags: mergeTaskTags(parseTaskTagsInput(ensureState().settings.taskTagsInput), task.tags)
  })
  if (!validation.ok) {
    return failureResult(validation.error)
  }

  const currentTags = normalizeTaskTags(task.tags)
  if (
    task.title === validation.title &&
    task.description === validation.description &&
    sameTaskTags(currentTags, validation.tags)
  ) {
    return successResult()
  }

  task.title = validation.title
  task.description = validation.description
  task.tags = validation.tags
  saveState()
  return successResult()
}

function completeRepositoryTask(input: CompleteRepositoryTaskInput): MutationResult {
  const repository = findRepository(input.repositoryId)
  if (!repository) {
    return failureResult('Repository not found.')
  }

  const currentTasks = repository.tasks ?? []
  const nextTasks = currentTasks.filter((task) => task.id !== input.taskId)
  if (nextTasks.length === currentTasks.length) {
    return failureResult('Task not found.')
  }

  repository.tasks = nextTasks
  saveState()
  return successResult()
}

function createThread(input: CreateThreadInput): MutationResult {
  const state = ensureState()
  const repository = state.repositories.find((item) => item.id === input.repositoryId)

  if (!repository) {
    return failureResult('Repository not found.')
  }

  const createdAt = nowIso()
  const customTitle = normalizeCustomTitle(input.title)

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
      lastUserMessage: null,
      mode: 'worktree',
      branchName,
      worktreePath,
      sessionName: buildThreadSessionName(repository),
      resumeSessionId: null,
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
      lastUserMessage: null,
      mode: 'new-branch',
      branchName,
      worktreePath: null,
      sessionName: buildThreadSessionName(repository),
      resumeSessionId: null,
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
    lastUserMessage: null,
    mode: 'active-branch',
    branchName: currentBranch,
    worktreePath: null,
    sessionName: buildThreadSessionName(repository),
    resumeSessionId: null,
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
    runCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: nowIso(),
    tasks: []
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
  stopThreadRunSession(threadId)
  let postWorktreeRemoveError: string | null = null

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

    try {
      removeWorktree(thread, repository.path, dirty)
    } catch (error) {
      return failureResult(error instanceof Error ? error.message : String(error))
    }

    try {
      runPostWorktreeRemoveCommand(repository, thread)
    } catch (error) {
      postWorktreeRemoveError = error instanceof Error ? error.message : String(error)
    }
  }

  if (thread.mode === 'new-branch') {
    const branchRemovalResult = await maybeRemoveLocalBranchForNewBranchThread(
      thread,
      repository.path
    )
    if (branchRemovalResult) {
      return branchRemovalResult
    }
  }

  state.threads = state.threads.filter((item) => item.id !== thread.id)

  if (state.ui.selectedThreadId === thread.id) {
    state.ui.selectedThreadId = null
    state.ui.selectedRepositoryId = repository.id
  }

  saveState()
  return postWorktreeRemoveError
    ? failureResult(`Worktree removed, but post-remove script failed: ${postWorktreeRemoveError}`)
    : successResult()
}

function updateSettings(input: UpdateSettingsInput): MutationResult {
  const state = ensureState()
  state.settings.globalFlagsInput = input.globalFlagsInput.trim()
  state.settings.terminalFontFamilyInput = normalizeTerminalFontFamilyInput(
    input.terminalFontFamilyInput
  )
  state.settings.taskTagsInput = normalizeTaskTagsInput(input.taskTagsInput)
  saveState()
  return successResult()
}

function updateRepository(input: UpdateRepositoryInput): MutationResult {
  const repository = findRepository(input.repositoryId)
  if (!repository) {
    return failureResult('Repository not found.')
  }

  const faviconValidation = validateRepositoryFaviconInput(repository.path, input.faviconPath)
  if (!faviconValidation.ok) {
    return failureResult(faviconValidation.error)
  }

  const runCommandValidation = validateRepositoryRunCommandInput(input.runCommand)
  if (!runCommandValidation.ok) {
    return failureResult('Run command is invalid.')
  }

  const postWorktreeRemoveCommandValidation = validateRepositoryPostWorktreeRemoveCommandInput(
    input.postWorktreeRemoveCommand
  )
  if (!postWorktreeRemoveCommandValidation.ok) {
    return failureResult('Post-worktree-remove script is invalid.')
  }

  if (
    repository.faviconPath === faviconValidation.path &&
    repository.runCommand === runCommandValidation.command &&
    repository.postWorktreeRemoveCommand === postWorktreeRemoveCommandValidation.command
  ) {
    return successResult()
  }

  repository.faviconPath = faviconValidation.path
  repository.runCommand = runCommandValidation.command
  repository.postWorktreeRemoveCommand = postWorktreeRemoveCommandValidation.command
  saveState()
  return successResult()
}

function updateThread(input: UpdateThreadInput): MutationResult {
  const thread = findThread(input.threadId)
  if (!thread) {
    return failureResult('Thread not found.')
  }

  const customTitle = normalizeCustomTitle(input.customTitle)
  if (thread.customTitle === customTitle) {
    return successResult()
  }

  thread.customTitle = customTitle
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

  const normalizedTitle = normalizeCopilotTitle(thread, trimmedTitle)
  if (thread.latestCopilotTitle === normalizedTitle) {
    return true
  }

  thread.latestCopilotTitle = normalizedTitle
  saveState()
  return true
}

function updateThreadResumeSession(input: UpdateThreadResumeSessionInput): boolean {
  const thread = findThread(input.threadId)
  if (!thread) {
    return false
  }

  const nextSessionId = input.sessionId.trim()
  if (!nextSessionId) {
    return false
  }

  const shouldClearTitle = input.source === 'new'
  if (
    thread.resumeSessionId === nextSessionId &&
    (!shouldClearTitle || thread.latestCopilotTitle === null) &&
    thread.hasLaunched
  ) {
    return true
  }

  thread.resumeSessionId = nextSessionId
  thread.hasLaunched = true
  if (shouldClearTitle) {
    thread.latestCopilotTitle = null
  }
  saveState()
  return true
}

function updateThreadLastUserMessage(input: UpdateThreadLastUserMessageInput): boolean {
  const thread = findThread(input.threadId)
  if (!thread) {
    return false
  }

  const nextMessage = normalizeTrackedText(input.message)
  const nextActivityAt = nowIso()
  if (thread.lastUserMessage === nextMessage) {
    thread.lastActivityAt = nextActivityAt
    saveState()
    return true
  }

  thread.lastUserMessage = nextMessage
  thread.lastActivityAt = nextActivityAt
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
  app.on('before-quit', () => {
    appIsQuitting = true
    for (const session of threadRunSessions.values()) {
      session.stopping = true
      killChildProcessTree(session.child)
    }
    threadRunSessions.clear()
  })

  ipcMain.handle('app-state:get-snapshot', () => buildSnapshot())
  ipcMain.handle('app-state:refresh', () => buildSnapshot())
  ipcMain.handle('app-state:add-repository', () => addRepository())
  ipcMain.handle('app-state:create-repository-task', (_event, input: CreateRepositoryTaskInput) =>
    createRepositoryTask(input)
  )
  ipcMain.handle(
    'app-state:complete-repository-task',
    (_event, input: CompleteRepositoryTaskInput) => completeRepositoryTask(input)
  )
  ipcMain.handle('app-state:update-repository-task', (_event, input: UpdateRepositoryTaskInput) =>
    updateRepositoryTask(input)
  )
  ipcMain.handle('app-state:create-thread', (_event, input: CreateThreadInput) =>
    createThread(input)
  )
  ipcMain.handle('app-state:close-thread', (_event, threadId: string) => closeThread(threadId))
  ipcMain.handle('app-state:update-repository', (_event, input: UpdateRepositoryInput) =>
    updateRepository(input)
  )
  ipcMain.handle('app-state:start-thread-run', (_event, threadId: string) =>
    startThreadRun(threadId)
  )
  ipcMain.handle('app-state:stop-thread-run', (_event, threadId: string) => stopThreadRun(threadId))
  ipcMain.handle('app-state:update-thread', (_event, input: UpdateThreadInput) =>
    updateThread(input)
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
  ipcMain.handle(
    'app-state:update-thread-resume-session',
    (_event, input: UpdateThreadResumeSessionInput) => updateThreadResumeSession(input)
  )
  ipcMain.handle(
    'app-state:update-thread-last-user-message',
    (_event, input: UpdateThreadLastUserMessageInput) => updateThreadLastUserMessage(input)
  )
  ipcMain.handle('app-state:get-branch-status', (_event, input: BranchStatusRequest) =>
    getBranchStatus(input)
  )
  ipcMain.handle('app-state:get-thread-diff-summary', (_event, input: ThreadDiffQuery) =>
    getThreadDiffSummary(input)
  )
  ipcMain.handle('app-state:get-thread-diff-range-options', (_event, threadId: string) =>
    getThreadDiffRangeOptions(threadId)
  )
  ipcMain.handle('app-state:get-thread-diff-patch', (_event, input: ThreadDiffPatchRequest) =>
    getThreadDiffPatch(input)
  )
  ipcMain.handle('app-state:open-thread-working-directory', (_event, threadId: string) =>
    openThreadWorkingDirectory(threadId)
  )
  ipcMain.handle('app-state:open-thread-workspace-in-vscode', (_event, threadId: string) =>
    openThreadWorkspaceInVscode(threadId)
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
  updateSelection(thread.repositoryId, thread.id)
  saveState()
}
