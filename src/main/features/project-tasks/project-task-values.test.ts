import { describe, expect, it } from 'vitest'
import {
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
      title: 'Task',
      description: 'Description',
      tags: ['bug'],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    expect(normalizePersistedTask(task)).toBe(task)
    expect(normalizePersistedTask({ ...task, title: '   ', tags: [' bug ', 'bug'] })).toEqual({
      ...task,
      title: 'Untitled task',
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
        title: '',
        description: 'Details',
        tags: [],
        allowedTags: []
      })
    ).toEqual({ ok: false, error: 'Task title is required.' })
  })
})
