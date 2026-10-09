import { describe, expect, it } from 'vitest'
import type { PersistedProjectTask, PersistedRepository } from '../../../shared/app-types'
import {
  createGeneralProject,
  ensureGeneralProject,
  normalizePersistedRepository
} from './app-state-values'

const NOW = (): string => '2026-01-01T00:00:00.000Z'

function repository(id: string): PersistedRepository {
  return {
    id,
    name: id,
    path: `/repos/${id}`,
    backend: { kind: 'native' },
    faviconPath: null,
    runCommand: null,
    solutionFilePath: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: []
  }
}

describe('ensureGeneralProject', () => {
  it('prepends the general project with defaults rooted in the home directory', () => {
    const repositories = ensureGeneralProject([repository('alpha')], NOW, '/home/me')
    expect(repositories.map((item) => item.id)).toEqual(['general', 'alpha'])
    expect(repositories[0]).toMatchObject({
      kind: 'general',
      name: 'Computer',
      icon: 'monitor',
      iconColor: 'default',
      path: '/home/me'
    })
  })

  it('returns the same list when the general project is already normalized', () => {
    const repositories = [createGeneralProject(NOW(), '/home/me'), repository('alpha')]
    expect(ensureGeneralProject(repositories, NOW, '/home/me')).toBe(repositories)
  })

  it('keeps customizations and tasks, follows the home directory, and drops unsupported fields', () => {
    const general: PersistedRepository = {
      ...createGeneralProject(NOW(), '/old/home'),
      name: 'Workstation',
      icon: 'code',
      iconColor: '#7aa2f7',
      runCommand: 'bun dev',
      previewUrl: 'http://localhost:3000',
      tasks: [
        {
          id: 'task-1',
          title: 'Install tools',
          description: '',
          createdAt: NOW(),
          completedAt: null
        } as never
      ]
    }
    const [normalized] = ensureGeneralProject([general], NOW, '/home/me')
    expect(normalized).toMatchObject({
      name: 'Workstation',
      icon: 'code',
      iconColor: '#7aa2f7',
      path: '/home/me',
      runCommand: null
    })
    expect(normalized.previewUrl).toBeUndefined()
    expect(normalized.tasks).toHaveLength(1)
  })

  it('restores defaults for invalid values and removes duplicate general projects', () => {
    const general = { ...createGeneralProject(NOW(), '/home/me'), name: '  ', icon: 'nope' }
    const duplicate = { ...createGeneralProject(NOW(), '/home/me'), id: 'general-2' }
    const repositories = ensureGeneralProject(
      [repository('alpha'), general, duplicate],
      NOW,
      '/home/me'
    )
    expect(repositories.map((item) => item.id)).toEqual(['alpha', 'general'])
    expect(repositories[1]).toMatchObject({ name: 'Computer', icon: 'monitor' })
  })
})

describe('completed task persistence', () => {
  const completedTask = {
    id: 'done',
    number: 1,
    title: 'Done',
    description: '',
    tags: [],
    createdAt: NOW(),
    completedAt: NOW()
  }

  it('keeps completed tasks on repositories without replacing normalized ones', () => {
    const value = { ...repository('alpha'), completedTasks: [completedTask] }
    expect(normalizePersistedRepository(value)).toBe(value)
    expect(normalizePersistedRepository(repository('alpha')).completedTasks).toBeUndefined()
  })

  it('keeps completed tasks on the general project', () => {
    const general = { ...createGeneralProject(NOW(), '/home/me'), completedTasks: [completedTask] }
    const [normalized] = ensureGeneralProject([general], NOW, '/home/me')
    expect(normalized).toBe(general)
    expect(normalized.completedTasks).toEqual([completedTask])
  })

  it('backfills unique task numbers, oldest first, after existing numbers', () => {
    const task = (id: string, createdAt: string, number?: unknown): PersistedProjectTask =>
      ({ id, title: id, description: '', tags: [], createdAt, number }) as PersistedProjectTask
    const value: PersistedRepository = {
      ...repository('alpha'),
      tasks: [
        task('new', '2026-03-01T00:00:00.000Z'),
        task('numbered', '2026-01-01T00:00:00.000Z', 4),
        task('old', '2026-01-01T00:00:00.000Z')
      ],
      completedTasks: [
        { ...task('dup', '2026-02-01T00:00:00.000Z', 4), completedAt: NOW() },
        { ...task('bad', '2026-01-15T00:00:00.000Z', 'x'), completedAt: NOW() }
      ]
    }
    const normalized = normalizePersistedRepository(value)
    expect(normalized.tasks.map((item) => [item.id, item.number])).toEqual([
      ['new', 8],
      ['numbered', 4],
      ['old', 5]
    ])
    expect(normalized.completedTasks?.map((item) => [item.id, item.number])).toEqual([
      ['dup', 7],
      ['bad', 6]
    ])
    expect(normalizePersistedRepository(normalized)).toBe(normalized)

    const general = ensureGeneralProject(
      [{ ...createGeneralProject(NOW(), '/home/me'), tasks: [task('g', NOW())] }],
      NOW,
      '/home/me'
    )[0]
    expect(general.tasks[0].number).toBe(1)
  })
})

describe('commit settings persistence', () => {
  it('keeps valid commit settings and drops invalid ones', () => {
    const value: PersistedRepository = {
      ...repository('alpha'),
      commitMessageModel: { model: 'fast-model', reasoningEffort: 'high' },
      autoPushAfterCommit: true
    }
    expect(normalizePersistedRepository(value)).toBe(value)

    const invalid = normalizePersistedRepository({
      ...repository('alpha'),
      commitMessageModel: { model: '', reasoningEffort: 'medium' },
      autoPushAfterCommit: 'yes' as never
    })
    expect(invalid).not.toHaveProperty('commitMessageModel')
    expect(invalid).not.toHaveProperty('autoPushAfterCommit')
    expect(
      normalizePersistedRepository({ ...repository('alpha'), autoPushAfterCommit: false })
    ).not.toHaveProperty('autoPushAfterCommit')
  })
})

describe('favorite project persistence', () => {
  it('keeps favorites and drops invalid values', () => {
    const favorite: PersistedRepository = { ...repository('alpha'), favorite: true }
    expect(normalizePersistedRepository(favorite)).toBe(favorite)
    expect(
      normalizePersistedRepository({ ...repository('alpha'), favorite: 'yes' as never })
    ).not.toHaveProperty('favorite')
  })
})
