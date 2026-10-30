import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { createPastedTextStore } from './pasted-text-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function file(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pasted-texts-'))
  dirs.push(dir)
  return join(dir, 'pasted-texts.jsonl')
}

it('finds pasted text by message content in any session, after a restart', () => {
  const path = file()
  const pastedTexts = [{ name: 'Pasted text, 16 lines', text: 'a\nb' }]
  createPastedTextStore(path).savePastedTexts('a', 'Fix a\nb', pastedTexts)
  const store = createPastedTextStore(path)
  expect(store.getPastedTexts('Fix a\nb')).toEqual(pastedTexts)
  expect(store.getPastedTexts('Fix a\nb!')).toBeNull()
  expect(() => store.savePastedTexts('a', 'x', [{ name: 1 }] as never)).toThrow()
})
