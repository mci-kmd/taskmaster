// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const monacoMock = vi.hoisted(() => {
  let modelValue = ''

  const model = {
    getValue: vi.fn(() => modelValue),
    setValue: vi.fn((nextValue: string) => {
      modelValue = nextValue
    }),
    getLineCount: vi.fn(() => 200),
    dispose: vi.fn()
  }

  const editor = {
    onDidChangeModelContent: vi.fn(),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
    layout: vi.fn(),
    setPosition: vi.fn(),
    setSelection: vi.fn(),
    revealPositionInCenter: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    getModel: vi.fn(() => model)
  }

  const create = vi.fn(() => editor)
  const createModel = vi.fn(() => model)

  return {
    editor,
    model,
    create,
    createModel,
    reset: () => {
      modelValue = ''
      model.getValue.mockClear()
      model.setValue.mockClear()
      model.getLineCount.mockClear()
      model.getLineCount.mockReturnValue(200)
      model.dispose.mockClear()
      editor.onDidChangeModelContent.mockClear()
      editor.setModel.mockClear()
      editor.updateOptions.mockClear()
      editor.layout.mockClear()
      editor.setPosition.mockClear()
      editor.setSelection.mockClear()
      editor.revealPositionInCenter.mockClear()
      editor.focus.mockClear()
      editor.dispose.mockClear()
      editor.getModel.mockClear()
      editor.getModel.mockReturnValue(model)
      create.mockClear()
      createModel.mockClear()
    }
  }
})

vi.mock('../lib/monaco', () => ({
  TASKMASTER_MONACO_THEME: 'taskmaster-dark',
  monaco: {
    Uri: {
      from: vi.fn((value) => value)
    },
    editor: {
      create: monacoMock.create,
      createModel: monacoMock.createModel,
      ScrollType: {
        Immediate: 1
      }
    }
  }
}))

import MonacoFileEditor from './MonacoFileEditor'

describe('MonacoFileEditor', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

  beforeEach(() => {
    monacoMock.reset()
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    cleanup()
    globalThis.requestAnimationFrame = originalRequestAnimationFrame
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  })

  it('reveals the requested line when mounted with an initial target', async () => {
    render(
      <MonacoFileEditor
        modelKey="thread:file"
        onChange={vi.fn()}
        path="src\\example.ts"
        readOnly={false}
        revealTarget={{ lineNumber: 42, token: 1 }}
        value={'first\nsecond\nthird'}
      />
    )

    await waitFor(() => {
      expect(monacoMock.editor.revealPositionInCenter).toHaveBeenCalled()
    })

    expect(monacoMock.editor.setSelection).toHaveBeenCalledWith({
      selectionStartLineNumber: 42,
      selectionStartColumn: 1,
      positionLineNumber: 42,
      positionColumn: 1
    })
    expect(monacoMock.editor.revealPositionInCenter).toHaveBeenLastCalledWith(
      { lineNumber: 42, column: 1 },
      1
    )
  })
})
