import { describe, expect, it } from 'vitest'
import {
  normalizePersistedCompletedTasks,
  normalizePersistedTask,
  normalizeTaskDescription,
  normalizeTaskTitle,
  sameTaskTags,
  validateRepositoryTaskValues
} from './project-task-values'

describe('project task values', () => {
  it('normalizes task title and description', () => {
    expect(normalizeTaskTitle('  Fix bug  ')).toBe('Fix bug')
    expect(normalizeTaskTitle('   ')).toBeNull()
    expect(normalizeTaskDescription('\nDetails\n')).toBe('Details')
    expect(normalizeTaskDescription(null)).toBeNull()
  })

  it('compares task tags by ordered value', () => {
    expect(sameTaskTags(['bug', 'feature'], ['bug', 'feature'])).toBe(true)
    expect(sameTaskTags(['feature', 'bug'], ['bug', 'feature'])).toBe(false)
  })

  it('normalizes persisted tasks without replacing already-normal tasks', () => {
    const task = {
      id: '1',
      number: 1,
      title: 'Task',
      description: 'Description',
      tags: ['bug'],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    expect(normalizePersistedTask(task)).toBe(task)
    expect(normalizePersistedTask({ ...task, title: '   ', tags: [' bug ', 'bug'] })).toEqual({
      ...task,
      title: '',
      tags: ['bug']
    })
  })

  it('validates task form values against allowed tags', () => {
    expect(
      validateRepositoryTaskValues({
        title: ' New task ',
        description: ' Details ',
        tags: ['bug', 'unknown'],
        allowedTags: ['bug']
      })
    ).toEqual({
      ok: true,
      title: 'New task',
      description: 'Details',
      tags: ['bug']
    })

    expect(
      validateRepositoryTaskValues({
        title: '  ',
        description: '',
        tags: [],
        allowedTags: []
      })
    ).toEqual({ ok: true, title: '', description: '', tags: [] })
  })

  it('canonicalizes GitHub issue links and rejects invalid ones', () => {
    const base = { title: 'T', description: '', tags: [], allowedTags: [] }
    expect(validateRepositoryTaskValues({ ...base, githubIssue: 'octo/app#5' })).toMatchObject({
      ok: true,
      githubIssueUrl: 'https://github.com/octo/app/issues/5'
    })
    expect(validateRepositoryTaskValues({ ...base, githubIssue: '  ' })).toMatchObject({
      ok: true,
      githubIssueUrl: undefined
    })
    expect(validateRepositoryTaskValues({ ...base, githubIssue: 'nope' })).toMatchObject({
      ok: false
    })

    const task = {
      id: '1',
      number: 1,
      title: 'Task',
      description: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const linked = { ...task, githubIssueUrl: 'https://github.com/octo/app/issues/5' }
    expect(normalizePersistedTask(linked)).toBe(linked)
    expect(normalizePersistedTask({ ...task, githubIssueUrl: 'octo/app#5' })).toEqual(linked)
    expect(normalizePersistedTask({ ...task, githubIssueUrl: 'garbage' })).toEqual(task)
  })

  it('normalizes completed tasks, keeping the same array when unchanged', () => {
    const task = {
      id: '1',
      title: 'Task',
      description: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-02T00:00:00.000Z'
    }
    const completed = [task]
    expect(normalizePersistedCompletedTasks(completed)).toBe(completed)
    expect(normalizePersistedCompletedTasks(undefined)).toBeUndefined()
    expect(normalizePersistedCompletedTasks('nope')).toBeUndefined()
    expect(
      normalizePersistedCompletedTasks([{ ...task, title: ' Task ', completedAt: undefined }])
    ).toEqual([{ ...task, completedAt: task.createdAt }])
  })
})
