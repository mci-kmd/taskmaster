import { app, nativeImage } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import type {
  OpenTaskAttachmentResult,
  PickTaskAttachmentsResult,
  TaskAttachmentPreviewRequest
} from '../../../shared/app-types'
import { guessMimeType, isPreviewableImage } from '../../../shared/task-attachments'
import type { TaskAttachmentStore } from './project-task-attachments'

const THUMBNAIL_SIZE = 160
const MAX_FULL_PREVIEW_BYTES = 25 * 1024 * 1024

/** Taskmaster's copies of attached files, in one folder per task. */
export function getTaskAttachmentsRoot(): string {
  return join(app.getPath('userData'), 'task-attachments')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function imageThumbnail(path: string): Promise<string | undefined> {
  if (!isPreviewableImage({ displayName: path })) return undefined
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(path, {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE
    })
    if (!thumbnail.isEmpty()) return thumbnail.toDataURL()
  } catch {
    // Thumbnails are unavailable on some platforms; fall back to decoding the image.
  }
  try {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return undefined
    return image.resize({ width: Math.min(THUMBNAIL_SIZE, image.getSize().width) }).toDataURL()
  } catch {
    return undefined
  }
}

async function fullImage(path: string): Promise<string | null> {
  const mimeType = guessMimeType(path)
  if (!mimeType || (await stat(path)).size > MAX_FULL_PREVIEW_BYTES) return null
  return `data:${mimeType};base64,${(await readFile(path)).toString('base64')}`
}

type TaskAttachmentFileDependencies = {
  store: TaskAttachmentStore
  /** Lets the user choose files; resolves to none when cancelled. */
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>
  /** Opens a file with the OS; resolves to an error message, or '' on success. */
  openPath: (path: string) => Promise<string>
}

/** Picking files to attach, and showing or opening stored attachments. */
export function createTaskAttachmentFileHandlers({
  store,
  selectFiles,
  openPath
}: TaskAttachmentFileDependencies): {
  pickTaskAttachments: () => Promise<PickTaskAttachmentsResult>
  getTaskAttachmentPreview: (request: TaskAttachmentPreviewRequest) => Promise<string | null>
  openTaskAttachment: (path: string) => Promise<OpenTaskAttachmentResult>
} {
  return {
    pickTaskAttachments: async () => {
      try {
        const result = await selectFiles()
        if (result.canceled) return { ok: false, cancelled: true }
        return {
          ok: true,
          files: await Promise.all(
            result.filePaths.map(async (path) => ({
              path,
              displayName: basename(path),
              previewUrl: await imageThumbnail(path)
            }))
          )
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    },

    getTaskAttachmentPreview: async (request) => {
      const path = request?.path
      if (!store.contains(path) || !isPreviewableImage({ displayName: path })) return null
      try {
        return request.size === 'full'
          ? await fullImage(path)
          : ((await imageThumbnail(path)) ?? null)
      } catch {
        return null
      }
    },

    openTaskAttachment: async (path) => {
      if (!store.contains(path)) return { ok: false, error: 'Attachment not found.' }
      const error = await openPath(path)
      return error ? { ok: false, error } : { ok: true }
    }
  }
}
