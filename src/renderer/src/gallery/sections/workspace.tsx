import { useEffect, useRef } from 'react'
import type {
  AppSettingsSnapshot,
  BranchStatusSnapshot,
  RepositorySnapshot,
  ThreadDiffFileContentRequest,
  ThreadDiffFileSummary,
  ThreadDiffPatchRequest,
  ThreadDiffQuery,
  ThreadSnapshot
} from '../../../../shared/app-types'
import ThreadDiffView from '../../components/ThreadDiffView'
import Workspace from '../../components/Workspace'
import { setApiFixture } from '../api-stub'
import type { GallerySection } from '../gallery-section'

/* Fixtures: three threads in the workspace header and a handful of diff states. */

const NOW = new Date().toISOString()

function makeThread(
  id: string,
  title: string,
  extra: Partial<ThreadSnapshot> = {}
): ThreadSnapshot {
  return {
    id,
    repositoryId: 'taskmaster',
    customTitle: title,
    displayTitle: title,
    latestCopilotTitle: null,
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'active-branch',
    projectKind: 'repository',
    branchName: 'main',
    displayBranchName: 'main',
    worktreePath: null,
    cwd: '/code/taskmaster',
    executionCwd: '/code/taskmaster',
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    commitPhase: null,
    previewUrl: null,
    commitAutoPush: false,
    createdAt: NOW,
    lastActivityAt: NOW,
    ...extra
  }
}

function makeRepository(extra: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    id: 'taskmaster',
    name: 'taskmaster',
    path: '/code/taskmaster',
    backend: { kind: 'native' },
    faviconPath: null,
    faviconUrl: null,
    runCommand: 'bun run dev',
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    previewUrl: 'http://localhost:5173',
    addedAt: NOW,
    tasks: [],
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    lastActivityAt: NOW,
    threads: [],
    ...extra
  }
}

const SETTINGS = {
  yoloEnabled: false,
  terminalFontFamilyInput: '',
  taskTagsInput: '',
  parsedTaskTags: [],
  resolvedTerminalFontFamily: ''
} as AppSettingsSnapshot

const WORKTREE_THREAD = makeThread('ws-worktree', 'Give the app a new coat of paint', {
  mode: 'worktree',
  branchName: 'theme/refresh',
  displayBranchName: 'theme/refresh',
  worktreePath: '/code/taskmaster-worktrees/theme-refresh',
  cwd: '/code/taskmaster-worktrees/theme-refresh',
  executionCwd: '/code/taskmaster-worktrees/theme-refresh',
  isRunCommandRunning: true,
  previewUrl: 'http://localhost:5173'
})
const BRANCH_THREAD = makeThread('ws-branch', 'Fix the flaky sync test', {
  mode: 'new-branch',
  branchName: 'fix/sync-test',
  displayBranchName: 'fix/sync-test',
  previewUrl: 'http://localhost:5173'
})
const GENERAL_THREAD = makeThread('ws-general', 'Plan the quarter', {
  projectKind: 'general',
  repositoryId: 'general',
  cwd: '/home/morten',
  executionCwd: '/home/morten'
})
const GENERAL_PROJECT = makeRepository({
  id: 'general',
  kind: 'general',
  name: 'General',
  path: '/home/morten',
  runCommand: null,
  previewUrl: undefined
})

const BRANCH_STATUS: Record<string, BranchStatusSnapshot> = {
  'ws-worktree': {
    ahead: 2,
    behind: 0,
    staged: 0,
    modified: 4,
    deleted: 0,
    untracked: 1,
    conflicted: 0
  },
  'ws-branch': {
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    deleted: 0,
    untracked: 0,
    conflicted: 0
  }
}

const FILES: ThreadDiffFileSummary[] = [
  file('src/renderer/src/lib/theme.ts', 'modified', 3, 2),
  file('src/renderer/src/components/ThemePicker.tsx', 'untracked', 88, null),
  file('src/renderer/src/styles/themes.css', 'modified', 40, 12),
  file('src/renderer/src/lib/old-theme.ts', 'deleted', null, 31),
  { ...file('docs/design.md', 'renamed', 4, 1), previousPath: 'docs/DESIGN.md' }
]

function file(
  path: string,
  status: ThreadDiffFileSummary['status'],
  additions: number | null,
  deletions: number | null
): ThreadDiffFileSummary {
  return {
    path,
    previousPath: null,
    projectRootPath: null,
    previousProjectRootPath: null,
    status,
    additions,
    deletions,
    isBinary: false
  }
}

const PATCH = `diff --git a/src/renderer/src/lib/theme.ts b/src/renderer/src/lib/theme.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/renderer/src/lib/theme.ts
+++ b/src/renderer/src/lib/theme.ts
@@ -12,7 +12,8 @@ const listeners = new Set<() => void>()
 let current: ThemeId = readStoredTheme()

 function readStoredTheme(): ThemeId {
-  const stored = window.localStorage.getItem('theme')
+  const stored = window.localStorage.getItem(STORAGE_KEY)
+  if (!stored) return DEFAULT_THEME
   return isThemeId(stored) ? stored : DEFAULT_THEME
 }

@@ -40,6 +41,6 @@ export function setTheme(id: ThemeId): void {
   const apply = (): void => {
     document.documentElement.dataset.theme = id
-    listeners.forEach((listener) => listener())
+    for (const listener of listeners) listener()
   }
   if (canAnimate()) {
     document.startViewTransition(apply)
`

const FILE_CONTENT = `import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME, isThemeId, type ThemeId } from '../../../shared/themes'

/** Remembers the theme between launches so the first paint already uses it. */
const STORAGE_KEY = 'taskmaster:theme'

const listeners = new Set<() => void>()
let current: ThemeId = readStoredTheme()

function readStoredTheme(): ThemeId {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (!stored) return DEFAULT_THEME
  return isThemeId(stored) ? stored : DEFAULT_THEME
}

export function useTheme(): ThemeId {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => current)
}
`

const never = (): Promise<never> => new Promise(() => {})

const ESC = '\u001b'
const TERMINAL_OUTPUT = [
  `${ESC}[1;34m~/code/taskmaster-worktrees/theme-refresh${ESC}[0m on ${ESC}[35m theme/refresh${ESC}[0m ${ESC}[31m[!?]${ESC}[0m`,
  `${ESC}[32m❯${ESC}[0m bun run test`,
  '',
  ` ${ESC}[32m✓${ESC}[0m src/renderer/src/lib/theme.test.ts ${ESC}[2m(6 tests)${ESC}[0m ${ESC}[33m12ms${ESC}[0m`,
  ` ${ESC}[32m✓${ESC}[0m src/renderer/src/components/Workspace.test.tsx ${ESC}[2m(5 tests)${ESC}[0m ${ESC}[33m48ms${ESC}[0m`,
  ` ${ESC}[31m✗${ESC}[0m src/renderer/src/components/ThreadDiffView.test.tsx ${ESC}[2m(1 test | 1 failed)${ESC}[0m`,
  `   ${ESC}[31mAssertionError${ESC}[0m: expected ${ESC}[32m'split'${ESC}[0m to be ${ESC}[31m'unified'${ESC}[0m`,
  '',
  ` ${ESC}[2mTest Files${ESC}[0m  ${ESC}[1;31m1 failed${ESC}[0m | ${ESC}[1;32m2 passed${ESC}[0m ${ESC}[90m(3)${ESC}[0m`,
  ` ${ESC}[2m     Tests${ESC}[0m  ${ESC}[1;31m1 failed${ESC}[0m | ${ESC}[1;32m11 passed${ESC}[0m ${ESC}[90m(12)${ESC}[0m`,
  ` ${ESC}[36mcyan${ESC}[0m ${ESC}[96mbright cyan${ESC}[0m ${ESC}[94mbright blue${ESC}[0m ${ESC}[95mbright magenta${ESC}[0m ${ESC}[93mbright yellow${ESC}[0m ${ESC}[97mbright white${ESC}[0m ${ESC}[37mwhite${ESC}[0m ${ESC}[30;47m black on white ${ESC}[0m`,
  '',
  `${ESC}[32m❯${ESC}[0m `
].join('\r\n')

type Listener = (payload: unknown) => void
const terminalListeners = new Set<Listener>()
const sessionListeners = new Set<Listener>()

// Fixtures answer only this section's threads (ids starting ws- or diff-).
const owns = (threadId: string | null | undefined): boolean =>
  Boolean(threadId && /^(ws|diff)-/.test(threadId))
const reply = <T,>(value: T): Promise<T> => Promise.resolve(value)

setApiFixture('appState.getBranchStatus', ({ threadId }: { threadId?: string }) =>
  owns(threadId) ? reply(BRANCH_STATUS[threadId!] ?? null) : undefined
)
setApiFixture('terminal.create', ({ threadId }: { threadId: string }) => {
  if (!owns(threadId)) return undefined
  if (threadId === 'ws-general') return reply({ ok: false, error: 'spawn /bin/zsh ENOENT' })
  const terminalId = `term:${threadId}`
  window.setTimeout(() => {
    terminalListeners.forEach((listener) => listener({ terminalId, data: TERMINAL_OUTPUT }))
  }, 50)
  return reply({ ok: true, terminalId })
})
// Subscriptions register a listener and leave the (no-op) unsubscribe to the default stub.
setApiFixture('terminal.onData', (listener: Listener) => {
  terminalListeners.add(listener)
  return undefined
})
setApiFixture('copilot.onSession', (listener: Listener) => {
  sessionListeners.add(listener)
  return undefined
})
// The conversation isn't part of this section; keep it loading while it is briefly mounted.
setApiFixture('copilot.getSession', (threadId: string) => (owns(threadId) ? never() : undefined))
setApiFixture('appState.getThreadDiffRangeOptions', (threadId: string) => {
  if (!owns(threadId)) return undefined
  if (threadId === 'diff-loading') return never()
  return reply({
    ok: true,
    options: {
      baseOptions: [
        { value: 'main', label: 'main', description: 'Primary branch' },
        { value: 'HEAD~2', label: 'HEAD~2', description: 'Add theme tokens' }
      ],
      headOptions: [
        { value: '__taskmaster_worktree__', label: 'Current changes', description: null },
        { value: 'HEAD', label: 'HEAD', description: null }
      ],
      defaultBaseRef: 'main',
      defaultHeadRef: '__taskmaster_worktree__'
    }
  })
})
setApiFixture('appState.getThreadDiffSummary', (query: ThreadDiffQuery) => {
  if (!owns(query.threadId)) return undefined
  if (query.threadId === 'diff-loading') return never()
  if (query.threadId === 'diff-error') {
    return reply({
      ok: false,
      error: 'fatal: not a git repository (or any of the parent directories)'
    })
  }
  const files = query.threadId === 'diff-empty' ? [] : FILES
  return reply({ ok: true, summary: { mode: query.mode, baseRef: null, headRef: null, files } })
})
setApiFixture('appState.getThreadDiffPatch', (request: ThreadDiffPatchRequest) => {
  if (!owns(request.threadId)) return undefined
  if (request.path.endsWith('old-theme.ts')) {
    return reply({ ok: false, error: 'git diff exited with code 128' })
  }
  return reply({ ok: true, patch: PATCH, isBinary: false })
})
setApiFixture('appState.getThreadDiffFileContent', (request: ThreadDiffFileContentRequest) =>
  owns(request.threadId)
    ? reply({
        ok: true,
        content: request.path.endsWith('.ts') ? FILE_CONTENT : '# Design\n',
        revisionToken: 'fixture'
      })
    : undefined
)

/** Clicks the named options once mounted, to open a view other than the default. */
function useClickOnMount(labels: string[]): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const key = labels.join('|')
  useEffect(() => {
    const timers = key.split('|').map((label, index) =>
      window.setTimeout(
        () => {
          const target = Array.from(
            ref.current?.querySelectorAll<HTMLElement>('[role="radio"], button') ?? []
          ).find((element) => element.textContent?.trim().endsWith(label))
          target?.click()
        },
        300 * (index + 1)
      )
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [key])
  return ref
}

const noop = (): void => {}
const asyncNoop = async (): Promise<void> => {}
const asyncTrue = async (): Promise<boolean> => true

function WorkspaceFixture({
  thread,
  repository,
  open,
  height = 420
}: {
  thread: ThreadSnapshot
  repository: RepositorySnapshot
  open: string[]
  height?: number
}): React.JSX.Element {
  const ref = useClickOnMount(open)
  return (
    <div className="tm-workspace-card" ref={ref} style={{ height }}>
      <Workspace
        hasRepositories
        onAddRepository={noop}
        onCompleteRepositoryTask={asyncNoop}
        onCreateRepositoryTask={asyncTrue}
        onNewThread={noop}
        onOpenSolutionInVisualStudio={noop}
        onOpenWorkingDirectory={noop}
        onOpenWorkingDirectoryInVscode={noop}
        onRefresh={asyncNoop}
        onReopenRepositoryTask={asyncNoop}
        onReorderRepositoryTasks={asyncNoop}
        onSessionsChange={noop}
        onStartRunCommand={noop}
        onStopRunCommand={noop}
        onUpdateRepositoryTask={asyncTrue}
        repositoryTaskBusy={false}
        runCommandBusy={false}
        selectedRepository={repository}
        selectedThread={thread}
        settings={SETTINGS}
        threads={[thread]}
      />
    </div>
  )
}

function DiffFixture({
  threadId,
  open = [],
  height = 300
}: {
  threadId: string
  open?: string[]
  height?: number
}): React.JSX.Element {
  const ref = useClickOnMount(open)
  return (
    <div className="tm-workspace-card" ref={ref} style={{ height }}>
      <div className="relative min-w-0 flex-1">
        <ThreadDiffView thread={makeThread(threadId, threadId)} />
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-2 font-mono text-[11px] text-fg-subtle">{children}</p>
}

function WorkspaceSection(): React.JSX.Element {
  useEffect(() => {
    // A turn that finished: running, then idle, marks the worktree thread Done.
    const emit = (phase: 'running' | 'idle'): void =>
      sessionListeners.forEach((listener) =>
        listener({
          snapshot: {
            threadId: WORKTREE_THREAD.id,
            title: null,
            phase,
            timeline: [],
            pendingInteraction: null,
            error: null
          }
        })
      )
    const timers = [
      window.setTimeout(() => emit('running'), 900),
      window.setTimeout(() => emit('idle'), 960)
    ]
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Worktree thread · Done · ahead of origin · run command running · terminal</Label>
        <WorkspaceFixture
          open={['Terminal']}
          repository={makeRepository()}
          thread={WORKTREE_THREAD}
        />
      </div>
      <div>
        <Label>New branch · clean · run command stopped (Preview disabled) · diff</Label>
        <WorkspaceFixture
          height={520}
          open={['Diff']}
          repository={makeRepository({ solutionFilePath: '/code/taskmaster/taskmaster.sln' })}
          thread={BRANCH_THREAD}
        />
      </div>
      <div>
        <Label>General project · terminal failed to open</Label>
        <WorkspaceFixture
          height={300}
          open={['Terminal']}
          repository={GENERAL_PROJECT}
          thread={GENERAL_THREAD}
        />
      </div>
    </div>
  )
}

function DiffSection(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>File view (Monaco) · editable, after a jump</Label>
        <DiffFixture height={420} open={['File']} threadId="diff-files" />
      </div>
      <div>
        <Label>Range scope · patch failed to load</Label>
        <DiffFixture height={360} open={['Range', 'old-theme.ts']} threadId="diff-range" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Loading</Label>
          <DiffFixture threadId="diff-loading" />
        </div>
        <div>
          <Label>Empty</Label>
          <DiffFixture threadId="diff-empty" />
        </div>
        <div>
          <Label>Error</Label>
          <DiffFixture threadId="diff-error" />
        </div>
      </div>
    </div>
  )
}

const section: GallerySection = {
  id: 'workspace',
  title: 'Workspace header, terminal and diff',
  order: 50,
  Component: WorkspaceSection
}

/** The diff states live in the same file so they share the fixtures above. */
export const diffSection: GallerySection = {
  id: 'diff',
  title: 'Diff view',
  order: 51,
  Component: DiffSection
}

export default section
