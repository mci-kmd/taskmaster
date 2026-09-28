// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CopilotAttachment } from '../../../../shared/app-types'
import { attachToDraft, registerComposer, useSessionDraft } from './session-drafts'

const blob = (displayName: string): CopilotAttachment => ({
  id: displayName,
  type: 'blob',
  data: 'AA==',
  mimeType: 'image/png',
  displayName
})

describe('attachToDraft', () => {
  it('appends markers to a closed composer draft with unique names', () => {
    const { result } = renderHook(() => useSessionDraft('closed-thread'))
    act(() => result.current[1]((draft) => ({ ...draft, prompt: 'Fix' })))
    act(() => attachToDraft('closed-thread', [blob('button.png')]))
    act(() => attachToDraft('closed-thread', [blob('button.png')]))
    expect(result.current[0].prompt).toBe('Fix [📎 button.png] [📎 button (2).png] ')
    expect(result.current[0].attachments.map((item) => item.displayName)).toEqual([
      'button.png',
      'button (2).png'
    ])
  })

  it('hands attachments to the open composer for the thread', () => {
    const attach = vi.fn()
    const unregister = registerComposer('open-thread', attach)
    attachToDraft('open-thread', [blob('a')])
    expect(attach).toHaveBeenCalledWith([expect.objectContaining({ displayName: 'a' })])
    unregister()
    attachToDraft('open-thread', [blob('b')])
    expect(attach).toHaveBeenCalledTimes(1)
  })
})
