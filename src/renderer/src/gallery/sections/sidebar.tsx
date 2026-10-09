import { useMemo, useState } from 'react'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { ProjectGlyph } from '../../components/ProjectIcon'
import Button from '../../components/ui/Button'
import type { SessionMap } from '../../components/TerminalSessions'
import type { CopilotThreadStatus, ThreadSessionState } from '../../components/ThreadTerminal'
import type {
  AppSnapshot,
  RepositorySnapshot,
  ThreadCommitPhase,
  ThreadSnapshot
} from '../../../../shared/app-types'
import { PROJECT_ICON_COLORS } from '../../../../shared/project-icons'
import type { GallerySection } from '../gallery-section'

const MINUTE = 60_000

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function makeThread(
  id: string,
  repositoryId: string,
  title: string,
  branch: string,
  activityAgo: number,
  extra: Partial<ThreadSnapshot> = {}
): ThreadSnapshot {
  const at = ago(activityAgo)
  return {
    id,
    repositoryId,
    latestCopilotTitle: null,
    lastUserMessage: null,
    resumeSessionId: null,
    mode: 'active-branch',
    projectKind: 'repository',
    branchName: branch,
    worktreePath: null,
    createdAt: at,
    executionCwd: `/code/${repositoryId}`,
    backend: { kind: 'native' },
    isRunCommandRunning: false,
    commitPhase: null,
    previewUrl: null,
    commitAutoPush: false,
    customTitle: title,
    displayTitle: title,
    lastActivityAt: at,
    displayBranchName: branch,
    cwd: `/code/${repositoryId}`,
    ...extra
  }
}

function makeRepository(
  id: string,
  icon: string,
  iconColor: string,
  threads: ThreadSnapshot[],
  extra: Partial<RepositorySnapshot> = {}
): RepositorySnapshot {
  return {
    id,
    name: id,
    path: `/code/${id}`,
    threads,
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01',
    lastActivityAt: '2026-01-01',
    tasks: [],
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    faviconUrl: null,
    icon,
    iconColor,
    ...extra
  }
}

function fixtureRepositories(): RepositorySnapshot[] {
  return [
    makeRepository('taskmaster', 'layers', '#bb9af7', [
      makeThread('paint', 'taskmaster', 'Give the app a new coat of paint', 'theme/refresh', 0, {
        isRunCommandRunning: true
      }),
      makeThread(
        'flaky',
        'taskmaster',
        'Fix flaky worktree cleanup test',
        'fix/cleanup',
        2 * MINUTE
      ),
      makeThread(
        'electron',
        'taskmaster',
        'Upgrade Electron to 39',
        'chore/electron-39',
        50 * MINUTE
      ),
      makeThread(
        'docs',
        'taskmaster',
        'Document the release process',
        'docs/release',
        3 * 24 * 60 * MINUTE,
        {
          settledAt: ago(2 * 24 * 60 * MINUTE)
        }
      )
    ]),
    makeRepository('ledger-api', 'database', '#73daca', [
      makeThread('csv', 'ledger-api', 'Add CSV export to reports', 'feat/csv-export', 14 * MINUTE),
      makeThread('push', 'ledger-api', 'Bump the rate limiter', 'fix/rate-limit', 19 * MINUTE, {
        commitPhase: 'pushing'
      }),
      makeThread(
        'schema',
        'ledger-api',
        'Tidy the schema migrations',
        'chore/schema',
        5 * 24 * 60 * MINUTE,
        {
          settledAt: ago(4 * 24 * 60 * MINUTE)
        }
      )
    ]),
    makeRepository('ledger-web', 'globe', '#f7768e', [
      makeThread(
        'cold',
        'ledger-web',
        'Investigate slow cold start',
        'perf/cold-start',
        26 * MINUTE,
        {
          commitPhase: 'hook'
        }
      ),
      makeThread(
        'passkeys',
        'ledger-web',
        'Migrate auth to passkeys',
        'feat/passkeys',
        3 * 60 * MINUTE
      ),
      makeThread(
        'connect',
        'ledger-web',
        'Profile the dashboard queries',
        'perf/queries',
        40 * MINUTE
      )
    ]),
    makeRepository(
      'notes',
      'book',
      'default',
      [
        makeThread('release', 'notes', 'Draft release notes for 2.4', 'main', 60 * MINUTE, {
          projectKind: 'general'
        })
      ],
      { favorite: true }
    )
  ]
}

function session(status: CopilotThreadStatus): ThreadSessionState {
  return {
    phase: 'running',
    exitCode: null,
    errorMessage: null,
    runtimeTitle: null,
    lastUserMessage: null,
    copilotStatus: status
  }
}

const INITIAL_STATUSES: Record<string, CopilotThreadStatus> = {
  paint: 'working',
  flaky: 'input',
  csv: 'done',
  electron: 'error',
  connect: 'connecting',
  passkeys: 'idle'
}

const STATUS_CYCLE: CopilotThreadStatus[] = [
  'idle',
  'connecting',
  'working',
  'input',
  'done',
  'error'
]
const COMMIT_CYCLE: Array<ThreadCommitPhase | null> = [null, 'generating', 'pushing']

const SETTINGS = {
  yoloEnabled: true,
  terminalFontFamilyInput: '',
  taskTagsInput: '',
  parsedTaskTags: [],
  resolvedTerminalFontFamily: 'monospace'
} as unknown as AppSnapshot['settings']

const noop = (): void => {}
const NO_REPOSITORIES: RepositorySnapshot[] = []
const NO_SESSIONS: SessionMap = new Map()

function GallerySidebar({
  repositories,
  selectedThreadId,
  sessions,
  onSelectThread = noop,
  onSettleThread = noop,
  onCloseThread = noop,
  onNewThread = noop,
  onAddRepository = noop
}: {
  repositories: RepositorySnapshot[]
  selectedThreadId: string | null
  sessions: SessionMap
  onSelectThread?: (id: string) => void
  onSettleThread?: (id: string, settled: boolean) => void
  onCloseThread?: (id: string) => void
  onNewThread?: (repositoryId: string) => void
  onAddRepository?: () => void
}): React.JSX.Element {
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(repositories[0]?.id ?? null)
  const [performanceOpen, setPerformanceOpen] = useState(false)
  const selectedThread =
    repositories
      .flatMap((repository) => repository.threads)
      .find((t) => t.id === selectedThreadId) ?? null
  return (
    <div className="tm-app-sidebar h-[760px] w-[288px] rounded-2xl bg-bg">
      <Sidebar
        snapshot={{
          repositories,
          settings: SETTINGS,
          selectedRepositoryId,
          selectedThreadId,
          sidebarWidth: 288
        }}
        selectedRepository={repositories.find((item) => item.id === selectedRepositoryId) ?? null}
        selectedThread={selectedThread}
        sessions={sessions}
        busyAddRepository={false}
        convertingThread={false}
        closingThread={false}
        onSelectRepository={setSelectedRepositoryId}
        onSelectThread={onSelectThread}
        onAddRepository={onAddRepository}
        onEditRepository={noop}
        onOpenRepositoryTasks={noop}
        onEditThread={noop}
        onNewThread={onNewThread}
        onOpenSettings={noop}
        onOpenPerformance={() => setPerformanceOpen(!performanceOpen)}
        performanceOpen={performanceOpen}
        onSettleThread={onSettleThread}
        onConvertThreadToWorktree={noop}
        onCloseThread={onCloseThread}
        onToggleRepositoryFavorite={noop}
        onRegenerateTitle={noop}
        regeneratingTitleIds={new Set()}
      />
    </div>
  )
}

function SidebarGallery(): React.JSX.Element {
  const [repositories, setRepositories] = useState(fixtureRepositories)
  const [statuses, setStatuses] = useState(INITIAL_STATUSES)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>('paint')
  const [hasRepositories, setHasRepositories] = useState(false)
  const notesOnly = useMemo(() => fixtureRepositories().slice(3), [])
  const sessions = useMemo<SessionMap>(
    () => new Map(Object.entries(statuses).map(([id, status]) => [id, session(status)])),
    [statuses]
  )

  const updateThread = (id: string, update: (thread: ThreadSnapshot) => ThreadSnapshot): void =>
    setRepositories((current) =>
      current.map((repository) => ({
        ...repository,
        threads: repository.threads.map((thread) => (thread.id === id ? update(thread) : thread))
      }))
    )
  const selected = selectedThreadId ?? 'paint'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            setStatuses((current) => {
              const index = STATUS_CYCLE.indexOf(current[selected] ?? 'idle')
              return { ...current, [selected]: STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length] }
            })
          }
        >
          Cycle status
        </Button>
        <Button
          size="sm"
          onClick={() =>
            updateThread(selected, (thread) => ({
              ...thread,
              commitPhase:
                COMMIT_CYCLE[(COMMIT_CYCLE.indexOf(thread.commitPhase) + 1) % COMMIT_CYCLE.length]
            }))
          }
        >
          Cycle commit
        </Button>
        <Button
          size="sm"
          onClick={() =>
            updateThread(selected, (thread) => ({
              ...thread,
              isRunCommandRunning: !thread.isRunCommandRunning
            }))
          }
        >
          Toggle app running
        </Button>
        <Button
          size="sm"
          onClick={() =>
            updateThread(selected, (thread) => ({ ...thread, lastActivityAt: ago(0) }))
          }
        >
          Bump activity
        </Button>
        <Button size="sm" onClick={() => setRepositories(fixtureRepositories())}>
          Reset
        </Button>
        <span className="text-[12px] text-fg-subtle">
          Acts on the selected thread. Hover a row to settle, or use its menu to close it.
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <GallerySidebar
          repositories={repositories}
          selectedThreadId={selectedThreadId}
          sessions={sessions}
          onSelectThread={setSelectedThreadId}
          onSettleThread={(id, settled) =>
            updateThread(id, (thread) => ({ ...thread, settledAt: settled ? ago(0) : undefined }))
          }
          onCloseThread={(id) =>
            setRepositories((current) =>
              current.map((repository) => ({
                ...repository,
                threads: repository.threads.filter((thread) => thread.id !== id)
              }))
            )
          }
          onNewThread={(repositoryId) =>
            setRepositories((current) =>
              current.map((repository) =>
                repository.id === repositoryId
                  ? {
                      ...repository,
                      threads: [
                        makeThread(`new-${Date.now()}`, repositoryId, 'New thread', 'main', 0),
                        ...repository.threads
                      ]
                    }
                  : repository
              )
            )
          }
        />
        <GallerySidebar
          repositories={hasRepositories ? notesOnly : NO_REPOSITORIES}
          selectedThreadId={null}
          sessions={NO_SESSIONS}
          onAddRepository={() => setHasRepositories(!hasRepositories)}
        />
        <div className="flex flex-col gap-4">
          <div className="h-[300px] w-[560px] rounded-[var(--workspace-radius)] bg-panel elevation-card">
            <EmptyState
              hasRepositories={false}
              hasRepository={false}
              onAddRepository={noop}
              onNewThread={noop}
            />
          </div>
          <div className="h-[300px] w-[560px] rounded-[var(--workspace-radius)] bg-panel elevation-card">
            <EmptyState hasRepositories hasRepository onAddRepository={noop} onNewThread={noop} />
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-panel p-4 elevation-card">
            {PROJECT_ICON_COLORS.map((color) => (
              <span
                className="flex items-center gap-1.5 text-[11px] text-fg-subtle"
                key={color.value}
                title={color.label}
              >
                <ProjectGlyph color={color.value} icon="layers" />
                {color.label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-bg p-4">
            {PROJECT_ICON_COLORS.map((color) => (
              <span
                className="flex items-center gap-1.5 text-[11px] text-fg-subtle"
                key={color.value}
                title={color.label}
              >
                <ProjectGlyph color={color.value} icon="code" />
                {color.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const section: GallerySection = {
  id: 'sidebar',
  title: 'Sidebar',
  order: 10,
  Component: SidebarGallery
}
export default section
