import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedRepository } from '../../../shared/app-types'
import {
  createTaskAttachmentStore,
  sanitizeAttachmentFileName,
  type TaskAttachmentStore
} from './project-task-attachments'
import { createProjectTaskService } from './project-task-service'

let workDir: string
let root: string
let store: TaskAttachmentStore

beforeEach(() => {
  workDir = mkdtempSync(join(process.cwd(), '.test-task-attachments-'))
  root = join(workDir, 'task-attachments')
  store = createTaskAttachmentStore(() => root)
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function sourceFile(name: string, content = 'content'): string {
  const path = join(workDir, name)
  writeFileSync(path, content)
  return path
}

describe('sanitizeAttachmentFileName', () => {
  it('keeps names safe on every platform', () => {
    expect(sanitizeAttachmentFileName('shot.png')).toBe('shot.png')
    expect(sanitizeAttachmentFileName('C:\\Users\\me\\a:b?.txt')).toBe('a_b_.txt')
    expect(sanitizeAttachmentFileName('../../evil.txt')).toBe('evil.txt')
    expect(sanitizeAttachmentFileName('con.txt')).toBe('_con.txt')
    expect(sanitizeAttachmentFileName('', 'image/png')).toBe('attachment.png')
    expect(sanitizeAttachmentFileName('Pasted image', 'image/png')).toBe('Pasted image.png')
    expect(sanitizeAttachmentFileName(`${'x'.repeat(300)}.md`)).toBe(`${'x'.repeat(120)}.md`)
  })
})

describe('task attachment store', () => {
  it('copies files and writes pasted data with unique names', () => {
    const source = sourceFile('shot.png', 'png-bytes')
    const first = store.save('task-1', 'a1', {
      kind: 'file',
      path: source,
      displayName: 'shot.png'
    })
    const second = store.save('task-1', 'a2', {
      kind: 'file',
      path: source,
      displayName: 'shot.png'
    })
    const pasted = store.save('task-1', 'a3', {
      kind: 'blob',
      data: Buffer.from('pasted').toString('base64'),
      mimeType: 'image/png',
      displayName: 'Pasted image'
    })

    expect(first).toEqual({
      id: 'a1',
      displayName: 'shot.png',
      path: join(root, 'task-1', 'shot.png'),
      mimeType: 'image/png'
    })
    expect(second.displayName).toBe('shot (2).png')
    expect(pasted).toMatchObject({ displayName: 'Pasted image.png', mimeType: 'image/png' })
    expect(readFileSync(second.path, 'utf8')).toBe('png-bytes')
    expect(readFileSync(pasted.path, 'utf8')).toBe('pasted')
    expect(existsSync(source)).toBe(true)
    expect(store.contains(first.path)).toBe(true)
    expect(store.contains(source)).toBe(false)
  })

  it('rejects missing files and folders', () => {
    expect(() =>
      store.save('task-1', 'a1', {
        kind: 'file',
        path: join(workDir, 'missing.txt'),
        displayName: 'missing.txt'
      })
    ).toThrow()
    expect(() =>
      store.save('task-1', 'a1', { kind: 'file', path: workDir, displayName: 'folder' })
    ).toThrow('not a file')
  })

  it('only deletes files it stored, and empty task folders', () => {
    const source = sourceFile('notes.txt')
    const saved = store.save('task-1', 'a1', {
      kind: 'file',
      path: source,
      displayName: 'notes.txt'
    })
    store.remove([saved, { path: source }])
    expect(existsSync(saved.path)).toBe(false)
    expect(existsSync(join(root, 'task-1'))).toBe(false)
    expect(existsSync(source)).toBe(true)

    store.save('task-2', 'a2', { kind: 'file', path: source, displayName: 'notes.txt' })
    store.removeTasks(['task-2', '..'])
    expect(existsSync(join(root, 'task-2'))).toBe(false)
    expect(existsSync(workDir)).toBe(true)
  })
})

describe('project task service attachments', () => {
  function setup(): {
    repository: PersistedRepository
    service: ReturnType<typeof createProjectTaskService>
    saveState: ReturnType<typeof vi.fn>
  } {
    const repository = {
      id: 'repo-1',
      tasks: [],
      completedTasks: []
    } as unknown as PersistedRepository
    const saveState = vi.fn()
    let ids = 0
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }
      }),
      findRepository: () => repository,
      saveState,
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => `id-${++ids}`,
      attachments: store
    })
    return { repository, service, saveState }
  }

  it('copies attachments when creating a task', () => {
    const { repository, service } = setup()
    const source = sourceFile('shot.png')
    const result = service.createRepositoryTask({
      repositoryId: 'repo-1',
      title: 'Task',
      description: '',
      tags: [],
      attachments: [
        { kind: 'file', path: source, displayName: 'shot.png' },
        { kind: 'blob', data: 'aGk=', mimeType: 'text/plain', displayName: 'note' }
      ]
    })

    expect(result.ok).toBe(true)
    expect(repository.tasks[0].attachments).toEqual([
      {
        id: 'id-2',
        displayName: 'shot.png',
        path: join(root, 'id-1', 'shot.png'),
        mimeType: 'image/png'
      },
      {
        id: 'id-3',
        displayName: 'note.txt',
        path: join(root, 'id-1', 'note.txt'),
        mimeType: 'text/plain'
      }
    ])
    expect(readFileSync(join(root, 'id-1', 'note.txt'), 'utf8')).toBe('hi')
  })

  it('keeps, adds and deletes attachments when updating a task', () => {
    const { repository, service, saveState } = setup()
    service.createRepositoryTask({
      repositoryId: 'repo-1',
      title: 'Task',
      description: '',
      tags: [],
      attachments: [
        { kind: 'file', path: sourceFile('a.txt'), displayName: 'a.txt' },
        { kind: 'file', path: sourceFile('b.txt'), displayName: 'b.txt' }
      ]
    })
    const task = repository.tasks[0]
    const [first, second] = task.attachments!
    saveState.mockClear()

    const base = {
      repositoryId: 'repo-1',
      taskId: task.id,
      title: 'Task',
      description: '',
      tags: []
    }
    expect(service.updateRepositoryTask(base).ok).toBe(true)
    expect(
      service.updateRepositoryTask({
        ...base,
        attachments: [
          { kind: 'existing', id: first.id },
          { kind: 'existing', id: second.id }
        ]
      }).ok
    ).toBe(true)
    expect(saveState).not.toHaveBeenCalled()
    expect(task.attachments).toEqual([first, second])

    const result = service.updateRepositoryTask({
      ...base,
      attachments: [
        { kind: 'existing', id: second.id },
        { kind: 'file', path: sourceFile('c.txt'), displayName: 'c.txt' }
      ]
    })
    expect(result.ok).toBe(true)
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(task.attachments?.map((attachment) => attachment.displayName)).toEqual([
      'b.txt',
      'c.txt'
    ])
    expect(existsSync(first.path)).toBe(false)
    expect(existsSync(second.path)).toBe(true)

    service.updateRepositoryTask({ ...base, attachments: [] })
    expect(task.attachments).toBeUndefined()
    expect(existsSync(join(root, task.id))).toBe(false)
  })

  it('rolls back copies when an attachment fails', () => {
    const { repository, service, saveState } = setup()
    const result = service.createRepositoryTask({
      repositoryId: 'repo-1',
      title: 'Task',
      description: '',
      tags: [],
      attachments: [
        { kind: 'file', path: sourceFile('a.txt'), displayName: 'a.txt' },
        { kind: 'file', path: join(workDir, 'missing.txt'), displayName: 'missing.txt' }
      ]
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^Could not attach the file\./)
    expect(repository.tasks).toEqual([])
    expect(saveState).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'id-1'))).toBe(false)
  })

  it('fails new attachments without a store but keeps existing ones', () => {
    const repository = {
      id: 'repo-1',
      tasks: [
        {
          id: 'task-1',
          number: 1,
          title: 'Task',
          description: '',
          tags: [],
          attachments: [{ id: 'a1', displayName: 'a.txt', path: 'C:\\a.txt' }],
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    } as unknown as PersistedRepository
    const service = createProjectTaskService({
      ensureState: () => ({
        settings: { yoloEnabled: true, terminalFontFamilyInput: '', taskTagsInput: '' }
      }),
      findRepository: () => repository,
      saveState: vi.fn(),
      successResult: () => ({ ok: true }),
      failureResult: (error) => ({ ok: false, error }),
      nowIso: () => '2026-01-01T00:00:00.000Z',
      createId: () => 'id'
    })
    const base = {
      repositoryId: 'repo-1',
      taskId: 'task-1',
      title: 'Renamed',
      description: '',
      tags: []
    }

    expect(
      service.updateRepositoryTask({
        ...base,
        attachments: [{ kind: 'blob', data: '', mimeType: 'text/plain', displayName: 'x' }]
      })
    ).toEqual({ ok: false, error: 'Attachments are not available.' })
    expect(service.updateRepositoryTask(base).ok).toBe(true)
    expect(repository.tasks[0].attachments).toHaveLength(1)
  })
})
