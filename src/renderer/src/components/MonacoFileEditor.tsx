import { useEffect, useLayoutEffect, useRef } from 'react'
import { monaco, TASKMASTER_MONACO_THEME } from '../lib/monaco'

type MonacoFileEditorProps = {
  modelKey: string
  path: string
  readOnly: boolean
  revealTarget?: {
    lineNumber: number
    token: number
  } | null
  value: string
  onChange: (value: string) => void
}

const MONACO_FONT_FAMILY =
  "'Geist Mono Variable', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace"

function buildModelUri(modelKey: string, path: string): monaco.Uri {
  const normalizedPath = path.replaceAll('\\', '/').replace(/^\/+/, '') || 'untitled.txt'
  return monaco.Uri.from({
    scheme: 'file',
    path: `/taskmaster/${normalizedPath}`,
    query: encodeURIComponent(modelKey)
  })
}

export default function MonacoFileEditor({
  modelKey,
  path,
  readOnly,
  revealTarget = null,
  value,
  onChange
}: MonacoFileEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)
  const pendingRevealTargetRef = useRef<MonacoFileEditorProps['revealTarget']>(null)
  const appliedRevealTokenRef = useRef<number | null>(null)
  const revealFrameIdsRef = useRef<number[]>([])

  const clearRevealFramesRef = useRef((): void => {
    for (const frameId of revealFrameIdsRef.current) {
      cancelAnimationFrame(frameId)
    }
    revealFrameIdsRef.current = []
  })

  const revealLineRef = useRef((lineNumber: number): void => {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model) {
      return
    }

    const boundedLineNumber = Math.max(1, Math.min(lineNumber, model.getLineCount()))
    const position = { lineNumber: boundedLineNumber, column: 1 }
    editor.layout()
    editor.setPosition(position)
    editor.setSelection({
      selectionStartLineNumber: boundedLineNumber,
      selectionStartColumn: 1,
      positionLineNumber: boundedLineNumber,
      positionColumn: 1
    })
    editor.revealPositionInCenter(position, monaco.editor.ScrollType.Immediate)
  })

  const flushPendingRevealRef = useRef((): void => {
    const pendingRevealTarget = pendingRevealTargetRef.current
    const editor = editorRef.current
    const model = modelRef.current
    if (!pendingRevealTarget || !editor || !model) {
      return
    }

    if (appliedRevealTokenRef.current === pendingRevealTarget.token) {
      return
    }

    appliedRevealTokenRef.current = pendingRevealTarget.token
    clearRevealFramesRef.current()
    revealLineRef.current(pendingRevealTarget.lineNumber)

    const firstFrameId = requestAnimationFrame(() => {
      revealLineRef.current(pendingRevealTarget.lineNumber)
      const secondFrameId = requestAnimationFrame(() => {
        revealLineRef.current(pendingRevealTarget.lineNumber)
        editor.focus()
      })
      revealFrameIdsRef.current.push(secondFrameId)
    })

    revealFrameIdsRef.current.push(firstFrameId)
  })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    const clearRevealFrames = clearRevealFramesRef.current
    if (!container) {
      return
    }

    const editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontFamily: MONACO_FONT_FAMILY,
      fontLigatures: false,
      fontSize: 12.5,
      glyphMargin: false,
      lineNumbersMinChars: 4,
      minimap: { enabled: false },
      padding: { top: 16, bottom: 16 },
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      tabSize: 2,
      theme: TASKMASTER_MONACO_THEME
    })
    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) {
        return
      }

      const model = editor.getModel()
      if (model) {
        onChangeRef.current(model.getValue())
      }
    })
    editorRef.current = editor
    flushPendingRevealRef.current()

    return () => {
      clearRevealFrames()
      editor.dispose()
      editorRef.current = null
      modelRef.current?.dispose()
      modelRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    const nextModel = monaco.editor.createModel('', undefined, buildModelUri(modelKey, path))
    const previousModel = modelRef.current
    suppressChangeRef.current = true
    editor.setModel(nextModel)
    suppressChangeRef.current = false
    modelRef.current = nextModel
    previousModel?.dispose()
    flushPendingRevealRef.current()
  }, [modelKey, path])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    const model = modelRef.current
    if (!model) {
      return
    }

    if (model.getValue() !== value) {
      suppressChangeRef.current = true
      model.setValue(value)
      suppressChangeRef.current = false
    }

    flushPendingRevealRef.current()
  }, [value])

  useLayoutEffect(() => {
    const clearRevealFrames = clearRevealFramesRef.current
    pendingRevealTargetRef.current = revealTarget
    if (!revealTarget) {
      return
    }

    appliedRevealTokenRef.current = null
    flushPendingRevealRef.current()

    return () => {
      clearRevealFrames()
    }
  }, [revealTarget])

  return <div className="tm-monaco-editor h-full min-h-0 w-full" ref={containerRef} />
}
