/** A small data URL of an image file for attachment chips, or undefined for other files. */
export async function imageFilePreview(file: File, size = 160): Promise<string | undefined> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return undefined
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/webp', 0.85)
  } catch {
    return undefined
  }
}

/** The file's contents, base64-encoded (without the data URL prefix). */
export async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File read failed.')))
    reader.readAsDataURL(file)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/** A name for clipboard content that has none, like a pasted screenshot. */
export function pastedFileName(file: File): string {
  return file.name || (file.type.startsWith('image/') ? 'Pasted image' : 'Pasted file')
}
