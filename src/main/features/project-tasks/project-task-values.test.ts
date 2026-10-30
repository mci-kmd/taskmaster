import { describe, expect, it } from 'vitest'
import {
  normalizePersistedCompletedTasks,
  normalizePersistedTask,
  normalizeTaskAttachments,
  normalizeTaskDescription,
  normalizeTaskTitle,
  parseTaskAttachmentInputs,
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

  it('normalizes stored attachments', () => {
    const image = {
      id: 'a1',
      displayName: 'shot.png',
      path: 'C:\\data\\shot.png',
      mimeType: 'image/png'
    }
    const file = { id: 'a2', displayName: 'notes.txt', path: 'C:\\data\\notes.txt' }
    const valid = [image, file]
    expect(normalizeTaskAttachments(valid)).toBe(valid)
    expect(normalizeTaskAttachments(undefined)).toBeUndefined()
    expect(normalizeTaskAttachments([])).toBeUndefined()
    expect(normalizeTaskAttachments('nope')).toBeUndefined()
    expect(
      normalizeTaskAttachments([image, { ...image }, { id: 'a3', path: 5 }, null, file])
    ).toEqual([image, file])

    const task = {
      id: 'task-1',
      number: 1,
      title: 'Task',
      description: '',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const withAttachments = { ...task, attachments: valid }
    expect(normalizePersistedTask(task)).toBe(task)
    expect(normalizePersistedTask(withAttachments)).toBe(withAttachments)
    expect(normalizePersistedTask({ ...task, attachments: [] })).toEqual(task)
    expect(normalizePersistedTask({ ...task, attachments: [file, file] })).toEqual({
      ...task,
      attachments: [file]
    })
  })

  it('parses attachment inputs', () => {
    expect(parseTaskAttachmentInputs(undefined)).toBeUndefined()
    expect(parseTaskAttachmentInputs(null)).toBeUndefined()
    expect(
      parseTaskAttachmentInputs([
        { kind: 'existing', id: 'a1' },
        { kind: 'file', path: 'C:\\shot.png', displayName: ' shot.png ' },
        { kind: 'blob', data: 'aGk=', mimeType: 'image/png', displayName: 'Pasted image' }
      ])
    ).toEqual([
      { kind: 'existing', id: 'a1' },
      { kind: 'file', path: 'C:\\shot.png', displayName: 'shot.png' },
      { kind: 'blob', data: 'aGk=', mimeType: 'image/png', displayName: 'Pasted image' }
    ])
    expect(parseTaskAttachmentInputs('nope')).toBeNull()
    expect(parseTaskAttachmentInputs([{ kind: 'file', path: '' }])).toBeNull()
    expect(parseTaskAttachmentInputs([{ kind: 'link', url: 'x' }])).toBeNull()

    const base = { title: 'Task', description: '', tags: [], allowedTags: [] }
    expect(validateRepositoryTaskValues({ ...base, attachments: [{ kind: 'nope' }] })).toEqual({
      ok: false,
      error: 'Invalid attachments.'
    })
    const valid = validateRepositoryTaskValues({
      ...base,
      attachments: [{ kind: 'existing', id: 'a1' }]
    })
    expect(valid.ok && valid.attachments).toEqual([{ kind: 'existing', id: 'a1' }])
    const omitted = validateRepositoryTaskValues(base)
    expect(omitted.ok && omitted.attachments).toBeUndefined()
  })
})
