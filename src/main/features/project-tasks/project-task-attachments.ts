import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { ProjectTaskAttachment, ProjectTaskAttachmentInput } from '../../../shared/app-types'
import { extensionForMimeType, guessMimeType } from '../../../shared/task-attachments'

export type NewTaskAttachmentInput = Exclude<ProjectTaskAttachmentInput, { kind: 'existing' }>

export type TaskAttachmentStore = {
  /** Copies a file (or writes pasted data) into the task's folder. Throws when that fails. */
  save: (
    taskId: string,
    attachmentId: string,
    input: NewTaskAttachmentInput
  ) => ProjectTaskAttachment
  /** Best effort: deletes stored copies, and task folders left empty. */
  remove: (attachments: readonly Pick<ProjectTaskAttachment, 'path'>[]) => void
  /** Best effort: deletes whole task folders, e.g. when their project is removed. */
  removeTasks: (taskIds: readonly string[]) => void
  /** Whether a path is a file Taskmaster stored for a task. */
  contains: (path: string) => boolean
}

export const MAX_TASK_ATTACHMENT_BYTES = 100 * 1024 * 1024
const MAX_NAME_LENGTH = 120
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
// eslint-disable-next-line no-control-regex
const INVALID_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g

function splitExtension(name: string): { stem: string; extension: string } {
  const match = /^(.+?)(\.[^.\s]{1,16})?$/.exec(name)
  return { stem: match?.[1] ?? name, extension: match?.[2] ?? '' }
}

/** A file name that is safe on every platform, keeping the original name where possible. */
export function sanitizeAttachmentFileName(name: string, mimeType?: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? ''
  let cleaned = lastSegment
    .replace(INVALID_NAME_CHARACTERS, '_')
    .trim()
    .replace(/[. ]+$/, '')
  if (!cleaned || /^\.+$/.test(cleaned)) cleaned = 'attachment'
  if (RESERVED_WINDOWS_NAME.test(cleaned)) cleaned = `_${cleaned}`

  let { stem, extension } = splitExtension(cleaned)
  if (!extension) {
    const fromMimeType = extensionForMimeType(mimeType)
    if (fromMimeType) extension = `.${fromMimeType}`
  }
  if (stem.length > MAX_NAME_LENGTH) stem = stem.slice(0, MAX_NAME_LENGTH).trimEnd()
  return `${stem}${extension}`
}

function uniquePath(directory: string, name: string): string {
  const { stem, extension } = splitExtension(name)
  let candidate = join(directory, name)
  for (let index = 2; existsSync(candidate); index++) {
    candidate = join(directory, `${stem} (${index})${extension}`)
  }
  return candidate
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

export function createTaskAttachmentStore(getRoot: () => string): TaskAttachmentStore {
  const taskDirectory = (taskId: string): string =>
    join(getRoot(), sanitizeAttachmentFileName(taskId))

  const removeIfEmpty = (directory: string): void => {
    try {
      if (isInside(getRoot(), directory) && readdirSync(directory).length === 0) {
        rmSync(directory, { recursive: true, force: true })
      }
    } catch {
      // Best effort.
    }
  }

  return {
    save: (taskId, attachmentId, input) => {
      const directory = taskDirectory(taskId)
      const mimeType =
        input.kind === 'blob' ? input.mimeType || undefined : guessMimeType(input.displayName)
      const name = sanitizeAttachmentFileName(
        input.displayName || (input.kind === 'file' ? input.path : ''),
        mimeType
      )
      mkdirSync(directory, { recursive: true })
      const target = uniquePath(directory, name)

      if (input.kind === 'file') {
        if (!isAbsolute(input.path)) throw new Error(`Cannot attach "${input.displayName}".`)
        const stats = statSync(input.path)
        if (!stats.isFile()) throw new Error(`"${input.displayName}" is not a file.`)
        if (stats.size > MAX_TASK_ATTACHMENT_BYTES) {
          throw new Error(`"${input.displayName}" is larger than 100 MB.`)
        }
        copyFileSync(input.path, target, constants.COPYFILE_EXCL)
      } else {
        const data = Buffer.from(input.data, 'base64')
        if (data.length > MAX_TASK_ATTACHMENT_BYTES) {
          throw new Error(`"${input.displayName}" is larger than 100 MB.`)
        }
        writeFileSync(target, data, { flag: 'wx' })
      }

      const displayName = target.slice(directory.length + 1)
      const storedMimeType = mimeType ?? guessMimeType(displayName)
      return {
        id: attachmentId,
        displayName,
        path: target,
        ...(storedMimeType ? { mimeType: storedMimeType } : {})
      }
    },

    remove: (attachments) => {
      const directories = new Set<string>()
      for (const attachment of attachments) {
        if (!isInside(getRoot(), attachment.path)) continue
        try {
          rmSync(attachment.path, { force: true })
          directories.add(dirname(attachment.path))
        } catch {
          // Best effort: a file in use stays until it is removed by hand.
        }
      }
      directories.forEach(removeIfEmpty)
    },

    removeTasks: (taskIds) => {
      for (const taskId of taskIds) {
        const directory = taskDirectory(taskId)
        try {
          if (isInside(getRoot(), directory)) rmSync(directory, { recursive: true, force: true })
        } catch {
          // Best effort.
        }
      }
    },

    contains: (path) => typeof path === 'string' && isInside(getRoot(), path)
  }
}
