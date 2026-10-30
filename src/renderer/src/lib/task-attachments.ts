import { useEffect, useState } from 'react'
import type {
  PickedTaskAttachment,
  ProjectTaskAttachment,
  ProjectTaskAttachmentInput,
  TaskAttachmentPreviewRequest
} from '../../../shared/app-types'
import { isPreviewableImage } from '../../../shared/task-attachments'
import { getRendererApi } from '../shared/api/client'
import { imageFilePreview, pastedFileName, readFileAsBase64 } from './file-attachments'

/** An attachment in a task form: already saved on the task, or added and saved with the form. */
export type TaskAttachmentDraft = {
  key: string
  displayName: string
  /** Thumbnail of a newly added image; saved ones load theirs from `saved`. */
  previewUrl?: string
  saved?: ProjectTaskAttachment
  input: ProjectTaskAttachmentInput
}

export const savedAttachmentDraft = (attachment: ProjectTaskAttachment): TaskAttachmentDraft => ({
  key: attachment.id,
  displayName: attachment.displayName,
  saved: attachment,
  input: { kind: 'existing', id: attachment.id }
})

export const pickedAttachmentDraft = (file: PickedTaskAttachment): TaskAttachmentDraft => ({
  key: crypto.randomUUID(),
  displayName: file.displayName,
  previewUrl: file.previewUrl,
  input: { kind: 'file', path: file.path, displayName: file.displayName }
})

/** A dropped or pasted file: by path when it is on disk, otherwise (clipboard) its contents. */
export async function fileAttachmentDraft(file: File): Promise<TaskAttachmentDraft> {
  const path = getRendererApi().copilot.getPathForFile(file)
  const previewUrl = await imageFilePreview(file)
  const displayName = pastedFileName(file)
  return {
    key: crypto.randomUUID(),
    displayName,
    previewUrl,
    input: path
      ? { kind: 'file', path, displayName }
      : {
          kind: 'blob',
          data: await readFileAsBase64(file),
          mimeType: file.type || 'application/octet-stream',
          displayName
        }
  }
}

export const toAttachmentInputs = (
  drafts: readonly TaskAttachmentDraft[]
): ProjectTaskAttachmentInput[] => drafts.map((draft) => draft.input)

// Attachment ids are never reused, so their thumbnails can be cached for the session.
const thumbnailCache = new Map<string, Promise<string | null>>()

function loadPreview(
  attachment: ProjectTaskAttachment,
  size: TaskAttachmentPreviewRequest['size']
): Promise<string | null> {
  const request = (): Promise<string | null> =>
    getRendererApi()
      .appState.getTaskAttachmentPreview({ path: attachment.path, size })
      .catch(() => null)
      .then((url) => url ?? null)
  if (size === 'full') return request()
  let cached = thumbnailCache.get(attachment.id)
  if (!cached) {
    cached = request()
    thumbnailCache.set(attachment.id, cached)
  }
  return cached
}

/** Data URL of a saved image attachment, loaded from the main process; null while loading. */
export function useTaskAttachmentPreview(
  attachment: ProjectTaskAttachment | undefined,
  size: TaskAttachmentPreviewRequest['size']
): string | null {
  const previewable = attachment !== undefined && isPreviewableImage(attachment)
  const [preview, setPreview] = useState<{ key: string; url: string | null } | null>(null)
  const key = attachment ? `${size}:${attachment.id}` : ''

  useEffect(() => {
    if (!attachment || !previewable) return
    let cancelled = false
    void loadPreview(attachment, size).then((url) => {
      if (!cancelled) setPreview({ key: `${size}:${attachment.id}`, url })
    })
    return () => {
      cancelled = true
    }
  }, [attachment, previewable, size])

  return previewable && preview?.key === key ? preview.url : null
}
