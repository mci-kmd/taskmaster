import { useState } from 'react'
import ProjectTaskManager from '../../components/ProjectTaskManager'
import type {
  CompletedProjectTaskSnapshot,
  ProjectTaskSnapshot,
  RepositorySnapshot
} from '../../../../shared/app-types'
import type { GallerySection } from '../gallery-section'

const DAY = 86_400_000

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

const openTasks: ProjectTaskSnapshot[] = [
  {
    id: 't1',
    number: 12,
    title: 'Crash when the login token expires',
    description:
      'The session view throws after the login refresh fails. Repro: leave the app open overnight.',
    tags: ['bug'],
    githubIssueUrl: 'https://github.com/octo/taskmaster/issues/34',
    createdAt: ago(2 * DAY)
  },
  {
    id: 't2',
    number: 13,
    title: 'Theme picker in Settings',
    description: 'Preview each theme in place and save the choice right away.',
    tags: ['feature', 'ui'],
    createdAt: ago(DAY)
  },
  {
    id: 't3',
    number: 14,
    title: 'Document the login flow',
    description: '',
    tags: ['docs'],
    createdAt: ago(3 * 3_600_000)
  },
  { id: 't4', number: 15, title: '', description: '', tags: [], createdAt: ago(600_000) }
]

const completedTasks: CompletedProjectTaskSnapshot[] = [
  {
    id: 'c1',
    number: 9,
    title: 'Settle threads from the sidebar',
    description: 'Adds a settle action to thread rows.',
    tags: ['feature'],
    createdAt: ago(9 * DAY),
    completedAt: ago(2 * DAY)
  },
  {
    id: 'c2',
    number: 10,
    title: 'Fix login redirect loop',
    description: '',
    tags: ['bug'],
    githubIssueUrl: 'https://github.com/octo/taskmaster/issues/21',
    createdAt: ago(8 * DAY),
    completedAt: ago(4 * DAY)
  }
]

function repository(
  tasks: ProjectTaskSnapshot[],
  completed: CompletedProjectTaskSnapshot[]
): RepositorySnapshot {
  return {
    id: `repo-${tasks.length}-${completed.length}`,
    name: 'taskmaster',
    path: '/code/taskmaster',
    threads: [],
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01',
    lastActivityAt: '2026-10-01',
    tasks,
    completedTasks: completed,
    currentBranch: 'main',
    primaryBranch: 'main',
    branchOptions: [],
    worktreeOptions: [],
    faviconUrl: null
  }
}

/** A live task manager: completing, reopening, adding and reordering update local fixtures. */
function LiveTasks({
  initialTasks,
  initialCompleted,
  label
}: {
  initialTasks: ProjectTaskSnapshot[]
  initialCompleted: CompletedProjectTaskSnapshot[]
  label: string
}): React.JSX.Element {
  const [tasks, setTasks] = useState(initialTasks)
  const [completed, setCompleted] = useState(initialCompleted)
  const [repo, setRepo] = useState(() => repository(initialTasks, initialCompleted))
  const update = (
    nextTasks: ProjectTaskSnapshot[],
    nextCompleted: CompletedProjectTaskSnapshot[]
  ): void => {
    setTasks(nextTasks)
    setCompleted(nextCompleted)
    setRepo((current) => ({ ...current, tasks: nextTasks, completedTasks: nextCompleted }))
  }
  return (
    <div
      className="relative h-[640px] overflow-hidden rounded-xl bg-panel elevation-card"
      data-gallery-tasks={label}
    >
      <ProjectTaskManager
        busy={false}
        onCompleteTask={async (taskId) => {
          const task = tasks.find((item) => item.id === taskId)
          if (!task) return
          update(
            tasks.filter((item) => item.id !== taskId),
            [{ ...task, completedAt: new Date().toISOString() }, ...completed]
          )
        }}
        onCreateTask={async (input) => {
          const number = Math.max(0, ...tasks.map((task) => task.number ?? 0)) + 1
          update(
            [
              ...tasks,
              {
                id: `new-${number}`,
                number,
                title: input.title,
                description: input.description,
                tags: input.tags ?? [],
                createdAt: new Date().toISOString()
              }
            ],
            completed
          )
          return true
        }}
        onReopenTask={async (taskId) => {
          const task = completed.find((item) => item.id === taskId)
          if (!task) return
          update(
            [...tasks, task],
            completed.filter((item) => item.id !== taskId)
          )
        }}
        onReorderTasks={async (taskIds) => {
          update(
            taskIds.flatMap((id) => tasks.find((task) => task.id === id) ?? []),
            completed
          )
        }}
        onUpdateTask={async (input) => {
          update(
            tasks.map((task) =>
              task.id === input.taskId
                ? {
                    ...task,
                    title: input.title,
                    description: input.description,
                    tags: input.tags ?? task.tags
                  }
                : task
            ),
            completed
          )
          return true
        }}
        repository={repo}
        taskTags={['bug', 'feature', 'docs', 'ui']}
      />
    </div>
  )
}

/**
 * Project tasks. Screenshot scripts reach other states by interacting, e.g. typing into the
 * search box (`[data-gallery-tasks="main"] input[type=search]`), clicking Edit or the
 * completed-tasks link.
 */
function Tasks(): React.JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
      <LiveTasks initialCompleted={completedTasks} initialTasks={openTasks} label="main" />
      <LiveTasks initialCompleted={[]} initialTasks={[]} label="empty" />
    </div>
  )
}

const section: GallerySection = {
  id: 'tasks',
  title: 'Project tasks',
  order: 41,
  Component: Tasks
}
export default section
