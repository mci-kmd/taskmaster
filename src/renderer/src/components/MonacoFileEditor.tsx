import { useEffect, useRef } from 'react'
import { monaco, TASKMASTER_MONACO_THEME } from '../lib/monaco'

type MonacoFileEditorProps = {
  modelKey: string
  path: string
  readOnly: boolean
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
  value,
  onChange
}: MonacoFileEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onChangeRef = useRef(onChange)
  const suppressChangeRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
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

    return () => {
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
  }, [modelKey, path])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    const model = modelRef.current
    if (!model) {
      return
    }

    if (model.getValue() === value) {
      return
    }

    suppressChangeRef.current = true
    model.setValue(value)
    suppressChangeRef.current = false
  }, [value])

  return <div className="tm-monaco-editor h-full min-h-0 w-full" ref={containerRef} />
}
