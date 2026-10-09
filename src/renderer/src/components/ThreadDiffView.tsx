import Select from './ui/Select'
import 'react-diff-view/style/index.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  computeOldLineNumber,
  computeNewLineNumber,
  Decoration,
  Diff,
  getCorrespondingNewLineNumber,
  Hunk,
  parseDiff
} from 'react-diff-view'
import type { DiffProps } from 'react-diff-view'
import type {
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSummary,
  ThreadDiffMode,
  ThreadDiffPatchRequest,
  ThreadDiffQuery,
  ThreadDiffRangeOption,
  ThreadDiffRangeOptions,
  ThreadSnapshot
} from '../../../shared/app-types'
import { ArrowRightIcon, RefreshIcon } from './Icons'
import MonacoFileEditor from './MonacoFileEditor'
import ResizeHandle from './ResizeHandle'
import Button from './ui/Button'
import { Field } from './ui/Field'
import Presence from './ui/Presence'
import SegmentedControl from './ui/SegmentedControl'
import { getRendererApi } from '../shared/api/client'
import { getSkippedHunkInfo } from '../lib/diff-hunks'
import { useLastValue, usePresence } from '../lib/motion'
import { useAnimatedListMotion, usePresenceList } from '../lib/use-presence-list'

const api = getRendererApi()

type ThreadDiffViewProps = {
  thread: ThreadSnapshot
}

type SummaryState = {
  status: 'loading' | 'ready' | 'error'
  files: ThreadDiffFileSummary[]
  error: string | null
}

type PatchState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  patch: string
  isBinary: boolean
  error: string | null
}

type RangeOptionsState = {
  status: 'loading' | 'ready' | 'error'
  options: ThreadDiffRangeOptions | null
  error: string | null
}

type FileGroup = {
  key: string
  title: string | null
  files: ThreadDiffFileSummary[]
}

type FilePaneMode = 'patch' | 'file'

type FileListItem =
  | { kind: 'group'; key: string; title: string; first: boolean }
  | { kind: 'file'; key: string; file: ThreadDiffFileSummary }

const getFileListItemKey = (item: FileListItem): string => item.key

type FileContentState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  content: string
  savedContent: string
  revisionToken: string | null
  error: string | null
  saveStatus: 'idle' | 'saving' | 'success' | 'error'
  saveMessage: string | null
}

type FileRevealTarget = {
  lineNumber: number
  token: number
}

type HoverJumpTarget = {
  cell: HTMLElement
  lineNumber: number
}

type DiffChange = Parameters<typeof computeNewLineNumber>[0]
type DiffHunks = Parameters<typeof getCorrespondingNewLineNumber>[0]

const DIFF_SPLIT_MIN_WIDTH_PX = 1320
const FILE_LIST_WIDTH_DEFAULT = 380
const FILE_LIST_WIDTH_MIN = 220
const FILE_LIST_WIDTH_MAX = 560
const DIFF_CONTENT_WIDTH_MIN = 480
const DIFF_PANE_GAP_PX = 12
const FILE_PANE_OPTIONS: Array<{
  value: FilePaneMode
  label: string
  description: string
}> = [
  {
    value: 'patch',
    label: 'Patch',
    description: 'Show the git patch for the selected file'
  },
  {
    value: 'file',
    label: 'File',
    description: 'Show the full file content'
  }
]

const DIFF_MODE_OPTIONS: Array<{
  value: ThreadDiffMode
  label: string
  description: string
}> = [
  {
    value: 'working-tree',
    label: 'Uncommitted',
    description: 'Show working tree changes for this thread'
  },
  {
    value: 'range',
    label: 'Range',
    description: 'Compare two refs or commits'
  }
]

function formatStatDelta(label: '+' | '-', value: number | null): string | null {
  return typeof value === 'number' ? `${label}${value}` : null
}

function splitPathForDisplay(path: string): {
  directory: string
  separator: string
  filename: string
} {
  const lastSeparatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (lastSeparatorIndex === -1) {
    return {
      directory: '',
      separator: '',
      filename: path
    }
  }

  return {
    directory: path.slice(0, lastSeparatorIndex),
    separator: path[lastSeparatorIndex] ?? '',
    filename: path.slice(lastSeparatorIndex + 1)
  }
}

function normalizeDisplayPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function getPathTail(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(
    normalizedPath.lastIndexOf('/'),
    normalizedPath.lastIndexOf('\\')
  )
  return lastSeparatorIndex === -1 ? normalizedPath : normalizedPath.slice(lastSeparatorIndex + 1)
}

function getProjectTitle(projectRootPath: string | null, cwd: string): string | null {
  if (projectRootPath === null) {
    return null
  }

  return projectRootPath.length > 0 ? getPathTail(projectRootPath) : getPathTail(cwd)
}

function getProjectRelativePath(path: string, projectRootPath: string | null): string {
  const normalizedPath = normalizeDisplayPath(path)
  if (projectRootPath === null || projectRootPath.length === 0) {
    return normalizedPath
  }

  const normalizedRootPath = normalizeDisplayPath(projectRootPath)
  const prefix = `${normalizedRootPath}/`
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath
}

function getPreviousPathDisplay(file: ThreadDiffFileSummary, cwd: string): string | null {
  if (!file.previousPath) {
    return null
  }

  const previousPath = getProjectRelativePath(file.previousPath, file.previousProjectRootPath)
  if (
    file.previousProjectRootPath !== null &&
    file.previousProjectRootPath !== file.projectRootPath
  ) {
    const previousProjectTitle = getProjectTitle(file.previousProjectRootPath, cwd)
    return previousProjectTitle ? `${previousProjectTitle}/${previousPath}` : previousPath
  }

  return previousPath
}

function getRangeOptionLabel(value: string, optionMap: Map<string, ThreadDiffRangeOption>): string {
  return optionMap.get(value)?.label ?? value
}

function buildThreadDiffRequestKey(
  query: ThreadDiffQuery | null,
  threadId: string,
  mode: ThreadDiffMode,
  refreshToken: number
): string {
  if (!query) {
    return JSON.stringify(['pending-range', threadId, mode, refreshToken])
  }

  return JSON.stringify([
    query.threadId,
    query.mode,
    query.baseRef ?? null,
    query.headRef ?? null,
    refreshToken
  ])
}

function buildFileContentStateKey(requestKey: string, path: string): string {
  return `${requestKey}:${path}:file`
}

function createFileContentState(result?: ThreadDiffFileContentResult): FileContentState {
  if (!result) {
    return {
      status: 'idle',
      content: '',
      savedContent: '',
      revisionToken: null,
      error: null,
      saveStatus: 'idle',
      saveMessage: null
    }
  }

  if (!result.ok) {
    return {
      status: 'error',
      content: '',
      savedContent: '',
      revisionToken: null,
      error: result.error,
      saveStatus: 'idle',
      saveMessage: null
    }
  }

  return {
    status: 'ready',
    content: result.content,
    savedContent: result.content,
    revisionToken: result.revisionToken,
    error: null,
    saveStatus: 'idle',
    saveMessage: null
  }
}

function resolveFileJumpLineNumber(change: DiffChange, hunks: DiffHunks): number | null {
  const directLineNumber = computeNewLineNumber(change)
  if (directLineNumber > 0) {
    return directLineNumber
  }

  const deletedLineNumber = computeOldLineNumber(change)
  if (deletedLineNumber <= 0) {
    return null
  }

  const mappedLineNumber = getCorrespondingNewLineNumber(hunks, deletedLineNumber)
  if (mappedLineNumber > 0) {
    return mappedLineNumber
  }

  for (let offset = 1; offset <= 20; offset += 1) {
    const forwardLineNumber = getCorrespondingNewLineNumber(hunks, deletedLineNumber + offset)
    if (forwardLineNumber > 0) {
      return forwardLineNumber
    }

    const backwardCandidate = deletedLineNumber - offset
    if (backwardCandidate > 0) {
      const backwardLineNumber = getCorrespondingNewLineNumber(hunks, backwardCandidate)
      if (backwardLineNumber > 0) {
        return backwardLineNumber
      }
    }
  }

  return null
}

function renderPatchHunks(diffType: DiffProps['diffType'], hunks: DiffHunks): React.JSX.Element[] {
  return hunks.flatMap((hunk, index) => {
    const elements: React.JSX.Element[] = []
    const skippedHunkInfo = index > 0 ? getSkippedHunkInfo(diffType, hunks[index - 1], hunk) : null

    if (skippedHunkInfo) {
      elements.push(
        <Decoration contentClassName="tm-diff-gap-cell" key={`gap:${hunk.content}:${index}`}>
          <div className="tm-diff-gap" title={skippedHunkInfo.label}>
            <span aria-hidden="true" className="tm-diff-gap__line" />
            <span className="tm-diff-gap__label">{skippedHunkInfo.label}</span>
            <span aria-hidden="true" className="tm-diff-gap__line" />
          </div>
        </Decoration>
      )
    }

    elements.push(<Hunk hunk={hunk} key={`hunk:${hunk.content}:${index}`} />)

    return elements
  })
}

export default function ThreadDiffView({ thread }: ThreadDiffViewProps): React.JSX.Element {
  const [mode, setMode] = useState<ThreadDiffMode>('working-tree')
  const [rangeOptionsState, setRangeOptionsState] = useState<RangeOptionsState>({
    status: 'loading',
    options: null,
    error: null
  })
  const [selectedRange, setSelectedRange] = useState({
    baseRef: '',
    headRef: ''
  })
  const [summaryState, setSummaryState] = useState<SummaryState>({
    status: 'loading',
    files: [],
    error: null
  })
  const [loadedSummaryKey, setLoadedSummaryKey] = useState<string | null>(null)
  const [patchStates, setPatchStates] = useState<Record<string, PatchState>>({})
  const [fileContentStates, setFileContentStates] = useState<Record<string, FileContentState>>({})
  const [filePaneMode, setFilePaneMode] = useState<FilePaneMode>('patch')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [fileRevealTarget, setFileRevealTarget] = useState<FileRevealTarget | null>(null)
  const [hoverJumpTarget, setHoverJumpTarget] = useState<HoverJumpTarget | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [diffPaneWidth, setDiffPaneWidth] = useState<number | null>(null)
  const [fileListWidth, setFileListWidth] = useState(FILE_LIST_WIDTH_DEFAULT)
  const diffPaneRef = useRef<HTMLDivElement | null>(null)
  const paneContainerRef = useRef<HTMLDivElement | null>(null)
  const [paneContainerWidth, setPaneContainerWidth] = useState<number | null>(null)

  const query = useMemo<ThreadDiffQuery | null>(() => {
    if (mode === 'range') {
      if (!selectedRange.baseRef || !selectedRange.headRef) {
        return null
      }

      return {
        threadId: thread.id,
        mode,
        baseRef: selectedRange.baseRef,
        headRef: selectedRange.headRef
      }
    }

    return {
      threadId: thread.id,
      mode
    }
  }, [mode, selectedRange.baseRef, selectedRange.headRef, thread.id])

  const requestKey = useMemo(() => {
    return buildThreadDiffRequestKey(query, thread.id, mode, refreshToken)
  }, [mode, query, refreshToken, thread.id])

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRangeOptionsState({
      status: 'loading',
      options: null,
      error: null
    })
    setSelectedRange({
      baseRef: '',
      headRef: ''
    })

    void api.appState
      .getThreadDiffRangeOptions(thread.id)
      .then((result) => {
        if (cancelled) {
          return
        }

        if (!result.ok) {
          setRangeOptionsState({
            status: 'error',
            options: null,
            error: result.error
          })
          return
        }

        setRangeOptionsState({
          status: 'ready',
          options: result.options,
          error: null
        })
        setSelectedRange({
          baseRef: result.options.defaultBaseRef,
          headRef: result.options.defaultHeadRef
        })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setRangeOptionsState({
          status: 'error',
          options: null,
          error: error instanceof Error ? error.message : String(error)
        })
      })

    return () => {
      cancelled = true
    }
  }, [thread.id])

  useEffect(() => {
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSummaryState({
        status: 'loading',
        files: [],
        error: null
      })
      setLoadedSummaryKey(null)
      setSelectedPath(null)
      return
    }

    let cancelled = false

    void api.appState
      .getThreadDiffSummary(query)
      .then((result) => {
        if (cancelled) {
          return
        }

        if (!result.ok) {
          setSummaryState({
            status: 'error',
            files: [],
            error: result.error
          })
          setLoadedSummaryKey(requestKey)
          setSelectedPath(null)
          return
        }

        const files = result.summary.files
        setSummaryState({
          status: 'ready',
          files,
          error: null
        })
        setLoadedSummaryKey(requestKey)
        setSelectedPath((current) =>
          files.some((file) => file.path === current) ? current : (files[0]?.path ?? null)
        )
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setSummaryState({
          status: 'error',
          files: [],
          error: error instanceof Error ? error.message : String(error)
        })
        setLoadedSummaryKey(requestKey)
        setSelectedPath(null)
      })

    return () => {
      cancelled = true
    }
  }, [query, requestKey])

  const rangeOptionMap = useMemo(() => {
    const entries = [
      ...(rangeOptionsState.options?.baseOptions ?? []),
      ...(rangeOptionsState.options?.headOptions ?? [])
    ]
    return new Map(entries.map((option) => [option.value, option] as const))
  }, [rangeOptionsState.options])

  const rangeOptions = rangeOptionsState.options
  const selectedFile = useMemo(() => {
    return summaryState.files.find((file) => file.path === selectedPath) ?? null
  }, [selectedPath, summaryState.files])
  const fileGroups = useMemo<FileGroup[]>(() => {
    const groups = new Map<string, FileGroup>()

    for (const file of summaryState.files) {
      const key =
        file.projectRootPath === null ? '__ungrouped__' : `project:${file.projectRootPath}`
      const existingGroup = groups.get(key)
      if (existingGroup) {
        existingGroup.files.push(file)
        continue
      }

      groups.set(key, {
        key,
        title: getProjectTitle(file.projectRootPath, thread.cwd),
        files: [file]
      })
    }

    return [...groups.values()]
  }, [summaryState.files, thread.cwd])

  const fileListItems = useMemo<FileListItem[]>(
    () =>
      fileGroups.flatMap((group, index) => [
        ...(group.title
          ? [
              {
                kind: 'group' as const,
                key: `group:${group.key}`,
                title: group.title,
                first: index === 0
              }
            ]
          : []),
        ...group.files.map((file) => ({
          kind: 'file' as const,
          key: `file:${file.previousPath ?? ''}:${file.path}`,
          file
        }))
      ]),
    [fileGroups]
  )
  // Files that appear or leave between refreshes slide in and out of the list.
  const fileEntries = usePresenceList(fileListItems, getFileListItemKey, thread.id)
  const fileListRef = useAnimatedListMotion<HTMLDivElement>(thread.id)

  const patchKey = selectedFile ? `${requestKey}:${selectedFile.path}` : null
  const fileContentKey = selectedFile
    ? buildFileContentStateKey(requestKey, selectedFile.path)
    : null
  const selectedPatchState = patchKey ? (patchStates[patchKey] ?? null) : null
  const selectedFileState = fileContentKey ? (fileContentStates[fileContentKey] ?? null) : null
  const summaryLoading =
    (mode === 'range' && !query && rangeOptionsState.status === 'loading') ||
    (!!query && loadedSummaryKey !== requestKey && summaryState.status !== 'error')
  const selectedFileDirty =
    selectedFileState?.status === 'ready' &&
    selectedFileState.content !== selectedFileState.savedContent
  const selectedFileReadOnly = mode !== 'working-tree'

  useEffect(() => {
    if (!query || !selectedFile || !patchKey || summaryLoading) {
      return
    }

    if (selectedPatchState) {
      return
    }

    let cancelled = false
    const request: ThreadDiffPatchRequest = {
      ...query,
      path: selectedFile.path,
      previousPath: selectedFile.previousPath,
      status: selectedFile.status
    }

    void api.appState
      .getThreadDiffPatch(request)
      .then((result) => {
        if (cancelled) {
          return
        }

        setPatchStates((current) => ({
          ...current,
          [patchKey]: result.ok
            ? {
                status: 'ready',
                patch: result.patch,
                isBinary: result.isBinary,
                error: null
              }
            : {
                status: 'error',
                patch: '',
                isBinary: selectedFile.isBinary,
                error: result.error
              }
        }))
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setPatchStates((current) => ({
          ...current,
          [patchKey]: {
            status: 'error',
            patch: '',
            isBinary: selectedFile.isBinary,
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      })

    return () => {
      cancelled = true
    }
  }, [patchKey, query, selectedFile, selectedPatchState, summaryLoading])

  useEffect(() => {
    if (filePaneMode !== 'file' || !query || !selectedFile || !fileContentKey || summaryLoading) {
      return
    }

    if (selectedFileState) {
      return
    }

    let cancelled = false
    const request: ThreadDiffFileContentRequest = {
      ...query,
      path: selectedFile.path,
      previousPath: selectedFile.previousPath,
      status: selectedFile.status
    }

    void api.appState
      .getThreadDiffFileContent(request)
      .then((result) => {
        if (cancelled) {
          return
        }

        setFileContentStates((current) => ({
          ...current,
          [fileContentKey]: createFileContentState(result)
        }))
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setFileContentStates((current) => ({
          ...current,
          [fileContentKey]: {
            status: 'error',
            content: '',
            savedContent: '',
            revisionToken: null,
            error: error instanceof Error ? error.message : String(error),
            saveStatus: 'idle',
            saveMessage: null
          }
        }))
      })

    return () => {
      cancelled = true
    }
  }, [fileContentKey, filePaneMode, query, selectedFile, selectedFileState, summaryLoading])

  const activePatchState = !selectedFile
    ? {
        status: 'idle',
        patch: '',
        isBinary: false,
        error: null
      }
    : summaryLoading || !selectedPatchState
      ? {
          status: 'loading',
          patch: '',
          isBinary: selectedFile.isBinary,
          error: null
        }
      : selectedPatchState

  const parsedDiffs = useMemo(() => {
    if (activePatchState.status !== 'ready' || !activePatchState.patch.trim()) {
      return []
    }

    return parseDiff(activePatchState.patch)
  }, [activePatchState.patch, activePatchState.status])
  const selectedParsedDiff = parsedDiffs[0] ?? null

  const summaryLabel =
    mode === 'range'
      ? query
        ? `${getRangeOptionLabel(query.baseRef ?? '', rangeOptionMap)} -> ${getRangeOptionLabel(query.headRef ?? '', rangeOptionMap)}`
        : rangeOptionsState.status === 'loading'
          ? 'Loading range...'
          : 'Range unavailable'
      : 'Working tree vs HEAD'
  const panelError =
    mode === 'range' && rangeOptionsState.status === 'error'
      ? rangeOptionsState.error
      : summaryState.status === 'error'
        ? summaryState.error
        : null
  const diffViewType =
    diffPaneWidth !== null && diffPaneWidth < DIFF_SPLIT_MIN_WIDTH_PX ? 'unified' : 'split'
  const maxFileListWidth = useMemo(() => {
    if (paneContainerWidth === null) {
      return FILE_LIST_WIDTH_MAX
    }

    return Math.max(
      FILE_LIST_WIDTH_MIN,
      Math.min(FILE_LIST_WIDTH_MAX, paneContainerWidth - DIFF_CONTENT_WIDTH_MIN - DIFF_PANE_GAP_PX)
    )
  }, [paneContainerWidth])
  const currentFileListWidth = Math.min(
    maxFileListWidth,
    Math.max(FILE_LIST_WIDTH_MIN, fileListWidth)
  )

  useEffect(() => {
    const container = diffPaneRef.current
    if (!container) {
      return
    }

    const updateWidth = (): void => {
      setDiffPaneWidth(container.getBoundingClientRect().width)
    }

    updateWidth()

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = paneContainerRef.current
    if (!container) {
      return
    }

    const updateWidth = (): void => {
      setPaneContainerWidth(container.getBoundingClientRect().width)
    }

    updateWidth()

    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  const handleRefresh = useCallback((): void => {
    setRefreshToken((current) => current + 1)
  }, [])

  const handleSelectPath = useCallback((path: string): void => {
    setSelectedPath(path)
    setFileRevealTarget(null)
    setHoverJumpTarget(null)
  }, [])

  const handleJumpToFileLine = useCallback((lineNumber: number): void => {
    setFilePaneMode('file')
    setHoverJumpTarget(null)
    setFileRevealTarget((current) => ({
      lineNumber,
      token: (current?.token ?? 0) + 1
    }))
  }, [])

  const handleFileContentChange = useCallback(
    (nextContent: string): void => {
      if (!fileContentKey) {
        return
      }

      setFileContentStates((current) => {
        const existing = current[fileContentKey]
        if (!existing || existing.status !== 'ready') {
          return current
        }

        return {
          ...current,
          [fileContentKey]: {
            ...existing,
            content: nextContent,
            saveStatus: 'idle',
            saveMessage: null
          }
        }
      })
    },
    [fileContentKey]
  )

  const handleRevertFile = useCallback((): void => {
    if (!fileContentKey) {
      return
    }

    setFileContentStates((current) => {
      const existing = current[fileContentKey]
      if (!existing || existing.status !== 'ready') {
        return current
      }

      return {
        ...current,
        [fileContentKey]: {
          ...existing,
          content: existing.savedContent,
          saveStatus: 'idle',
          saveMessage: null
        }
      }
    })
  }, [fileContentKey])

  const handleSaveFile = useCallback((): void => {
    if (!query || !selectedFile || !fileContentKey || !selectedFileState) {
      return
    }

    if (selectedFileState.status !== 'ready' || !selectedFileState.revisionToken) {
      return
    }

    const request: ThreadDiffFileSaveRequest = {
      ...query,
      path: selectedFile.path,
      previousPath: selectedFile.previousPath,
      status: selectedFile.status,
      content: selectedFileState.content,
      expectedRevisionToken: selectedFileState.revisionToken
    }

    setFileContentStates((current) => ({
      ...current,
      [fileContentKey]: {
        ...selectedFileState,
        saveStatus: 'saving',
        saveMessage: null
      }
    }))

    void api.appState
      .saveThreadDiffFileContent(request)
      .then((result) => {
        if (!result.ok) {
          setFileContentStates((current) => ({
            ...current,
            [fileContentKey]: {
              ...selectedFileState,
              saveStatus: 'error',
              saveMessage: result.error
            }
          }))
          return
        }

        const nextRefreshToken = refreshToken + 1
        const nextRequestKey = buildThreadDiffRequestKey(query, thread.id, mode, nextRefreshToken)
        const nextFileContentKey = buildFileContentStateKey(nextRequestKey, selectedFile.path)

        setFileContentStates((current) => ({
          ...current,
          [fileContentKey]: {
            ...selectedFileState,
            content: selectedFileState.content,
            savedContent: selectedFileState.content,
            revisionToken: result.revisionToken,
            saveStatus: 'success',
            saveMessage: 'Saved.'
          },
          [nextFileContentKey]: {
            ...selectedFileState,
            content: selectedFileState.content,
            savedContent: selectedFileState.content,
            revisionToken: result.revisionToken,
            saveStatus: 'success',
            saveMessage: 'Saved.'
          }
        }))
        setPatchStates((current) => {
          const next = { ...current }
          if (patchKey) {
            delete next[patchKey]
          }
          return next
        })
        setRefreshToken(nextRefreshToken)
      })
      .catch((error: unknown) => {
        setFileContentStates((current) => ({
          ...current,
          [fileContentKey]: {
            ...selectedFileState,
            saveStatus: 'error',
            saveMessage: error instanceof Error ? error.message : String(error)
          }
        }))
      })
  }, [
    fileContentKey,
    mode,
    patchKey,
    query,
    refreshToken,
    selectedFile,
    selectedFileState,
    thread.id
  ])

  const patchCodeEvents = useMemo<DiffProps['codeEvents']>(() => {
    if (
      filePaneMode !== 'patch' ||
      !selectedFile ||
      selectedFile.status === 'deleted' ||
      !selectedParsedDiff
    ) {
      return {}
    }

    const hunks = selectedParsedDiff.hunks

    return {
      onMouseEnter: ({ change }, event) => {
        if (!change) {
          setHoverJumpTarget(null)
          return
        }

        const lineNumber = resolveFileJumpLineNumber(change, hunks)
        if (!lineNumber) {
          setHoverJumpTarget(null)
          return
        }

        setHoverJumpTarget({
          cell: event.currentTarget,
          lineNumber
        })
      },
      onMouseLeave: (_args, event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return
        }

        setHoverJumpTarget((current) => (current?.cell === event.currentTarget ? null : current))
      }
    }
  }, [filePaneMode, selectedFile, selectedParsedDiff])

  const filePaneStatus = !selectedFile
    ? null
    : filePaneMode === 'patch'
      ? {
          tone: 'muted' as const,
          message:
            diffViewType === 'split' ? 'Patch view · split or unified' : 'Patch view · unified'
        }
      : !selectedFileState
        ? { tone: 'muted' as const, message: 'Loading full file…' }
        : selectedFileState?.status === 'loading'
          ? { tone: 'muted' as const, message: 'Loading full file…' }
          : selectedFileState?.status === 'error'
            ? { tone: 'error' as const, message: selectedFileState.error ?? 'Unable to load file.' }
            : selectedFileState?.status === 'ready'
              ? selectedFileState.saveStatus === 'saving'
                ? { tone: 'muted' as const, message: 'Saving…' }
                : selectedFileState.saveStatus === 'error'
                  ? {
                      tone: 'error' as const,
                      message: selectedFileState.saveMessage ?? 'Unable to save file.'
                    }
                  : selectedFileDirty
                    ? { tone: 'warning' as const, message: 'Unsaved changes' }
                    : selectedFileReadOnly
                      ? { tone: 'muted' as const, message: 'Snapshot · read-only' }
                      : selectedFileState.saveStatus === 'success'
                        ? {
                            tone: 'success' as const,
                            message: selectedFileState.saveMessage ?? 'Saved.'
                          }
                        : { tone: 'muted' as const, message: 'Current file · editable' }
              : { tone: 'muted' as const, message: 'Pick a changed file to inspect.' }
  const selectedFileAdditions = selectedFile ? formatStatDelta('+', selectedFile.additions) : null
  const selectedFileDeletions = selectedFile ? formatStatDelta('-', selectedFile.deletions) : null
  const selectedFileChangeLabel =
    selectedFile?.status === 'added' || selectedFile?.status === 'untracked'
      ? { text: 'Added', className: 'text-positive' }
      : selectedFile?.status === 'deleted'
        ? { text: 'Removed', className: 'text-danger' }
        : null
  const selectedPathDisplay = selectedFile
    ? splitPathForDisplay(normalizeDisplayPath(selectedFile.path))
    : null
  const fileEditable =
    filePaneMode === 'file' && selectedFileState?.status === 'ready' && !selectedFileReadOnly

  return (
    <div className="tm-diff">
      <section className="tm-diff-toolbar" aria-label="Diff scope">
        <div className="shrink-0">
          <SegmentedControl<ThreadDiffMode>
            ariaLabel="Diff scope"
            onChange={setMode}
            options={DIFF_MODE_OPTIONS}
            value={mode}
          />
        </div>

        {/* Keyed by mode so the range pickers and the scope note crossfade. */}
        {mode === 'range' ? (
          <div className="tm-fade-in flex min-w-0 flex-1 flex-wrap gap-3" key="range">
            <div className="min-w-[180px] flex-1">
              <Field
                hint={
                  rangeOptionsState.status === 'ready'
                    ? 'Current branch commits, oldest to newest.'
                    : undefined
                }
                htmlFor="thread-diff-base-ref"
                label="Base ref"
              >
                <Select
                  disabled={!rangeOptions}
                  id="thread-diff-base-ref"
                  aria-label="Base ref"
                  onChange={(value) =>
                    setSelectedRange((current) => ({ ...current, baseRef: value }))
                  }
                  value={selectedRange.baseRef}
                  options={
                    rangeOptions?.baseOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description ?? undefined
                    })) ?? []
                  }
                />
              </Field>
            </div>

            <div className="min-w-[180px] flex-1">
              <Field
                hint={
                  rangeOptionsState.status === 'ready'
                    ? 'Includes Current changes on top of HEAD.'
                    : undefined
                }
                htmlFor="thread-diff-head-ref"
                label="Compare ref"
              >
                <Select
                  disabled={!rangeOptions}
                  id="thread-diff-head-ref"
                  aria-label="Compare ref"
                  onChange={(value) =>
                    setSelectedRange((current) => ({ ...current, headRef: value }))
                  }
                  value={selectedRange.headRef}
                  options={
                    rangeOptions?.headOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                      description: option.description ?? undefined
                    })) ?? []
                  }
                />
              </Field>
            </div>
          </div>
        ) : (
          <div className="tm-fade-in min-w-0 flex-1" key="working-tree">
            <div className="tm-diff-eyebrow">Scope</div>
            <div className="mt-1 truncate text-[12.5px] text-fg-muted" title={thread.cwd}>
              Includes tracked and untracked changes in{' '}
              <span className="font-mono text-fg">{thread.cwd}</span>.
            </div>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="tm-diff-eyebrow">Diff set</div>
            <div className="tm-fade-in mt-1 font-mono text-[12px] text-fg-muted" key={summaryLabel}>
              {summaryLabel}
            </div>
          </div>
          <Button onClick={handleRefresh} size="sm" title="Refresh diffs" variant="secondary">
            <RefreshIcon width={11} height={11} />
            Refresh
          </Button>
        </div>
      </section>

      <Presence motion="collapse" show={mode === 'range' && rangeOptionsState.status === 'loading'}>
        <div className="tm-diff-notice">Loading branch commits...</div>
      </Presence>

      <Presence motion="collapse" show={mode === 'range' && rangeOptionsState.status === 'error'}>
        <div className="tm-diff-notice" data-tone="danger">
          {rangeOptionsState.error}
        </div>
      </Presence>

      {panelError ? (
        <section className="tm-diff-state tm-fade-in" key="error">
          <div className="max-w-md text-center">
            <div className="tm-diff-eyebrow text-danger">Diff load failed</div>
            <p className="mt-3 text-[13px] leading-6 text-fg-muted">{panelError}</p>
          </div>
        </section>
      ) : (
        <div className="tm-fade-in flex min-h-0 flex-1" key="panes" ref={paneContainerRef}>
          <div className="tm-diff-files" style={{ width: currentFileListWidth }}>
            <div className="tm-diff-files__head">
              <span className="tm-diff-eyebrow">Changed files</span>
              <span className="font-mono text-[11.5px] text-fg-subtle">
                {summaryState.files.length}
              </span>
              <Presence motion="fade" show={summaryLoading && summaryState.files.length > 0}>
                <span className="ml-auto text-[11.5px] text-fg-subtle" role="status">
                  Refreshing…
                </span>
              </Presence>
            </div>

            <div className="tm-diff-files__list" ref={fileListRef}>
              {summaryLoading && summaryState.files.length === 0 ? (
                <div className="tm-diff-files__message tm-fade-in" role="status">
                  Loading changed files…
                </div>
              ) : null}

              {summaryState.status === 'ready' && summaryState.files.length === 0 ? (
                <div className="tm-diff-files__message tm-fade-in">No diffs in this scope.</div>
              ) : null}

              {fileEntries.map(({ key, item, exitToken }) => {
                const exiting = exitToken !== null
                if (item.kind === 'group') {
                  return (
                    <div
                      className="tm-diff-files__group"
                      data-exiting={exiting || undefined}
                      data-first={item.first || undefined}
                      data-motion-key={key}
                      key={key}
                    >
                      {item.title}
                    </div>
                  )
                }

                const { file } = item
                const active = !exiting && file.path === selectedPath
                const pathDisplay = splitPathForDisplay(
                  getProjectRelativePath(file.path, file.projectRootPath)
                )
                const previousPathDisplay = getPreviousPathDisplay(file, thread.cwd)
                const tooltip =
                  file.previousPath !== null && file.previousPath.length > 0
                    ? `${file.path}\nfrom ${file.previousPath}`
                    : file.path

                return (
                  <button
                    aria-current={active || undefined}
                    className="tm-diff-file"
                    data-exiting={exiting || undefined}
                    data-motion-key={key}
                    data-selected={active || undefined}
                    data-status={file.status}
                    key={key}
                    onClick={() => handleSelectPath(file.path)}
                    tabIndex={exiting ? -1 : undefined}
                    title={tooltip}
                    type="button"
                  >
                    <span className="inline-flex min-w-0 max-w-full font-mono text-[12px]">
                      {pathDisplay.directory ? (
                        <span className="tm-truncate-start min-w-0 flex-1 text-fg-subtle">
                          {pathDisplay.directory}
                        </span>
                      ) : null}
                      {pathDisplay.separator ? (
                        <span className="shrink-0 text-fg-subtle">{pathDisplay.separator}</span>
                      ) : null}
                      <span className="tm-diff-file__name truncate">{pathDisplay.filename}</span>
                    </span>
                    {previousPathDisplay ? (
                      <span className="tm-truncate-start mt-[2px] block font-mono text-[11px] text-fg-subtle">
                        from {previousPathDisplay}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <ResizeHandle
              ariaLabel="Resize diff panes"
              className="tm-diff-pane-resize"
              max={maxFileListWidth}
              min={FILE_LIST_WIDTH_MIN}
              onResize={setFileListWidth}
              onResizeEnd={setFileListWidth}
              title="Drag to resize panes · double-click to collapse file list"
              width={currentFileListWidth}
            />
          </div>

          <section className="tm-diff-main">
            <div className="tm-diff-file-head">
              {selectedFile && selectedPathDisplay ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12.5px]" title={selectedFile.path}>
                      {selectedPathDisplay.directory ? (
                        <span className="text-fg-subtle">
                          {selectedPathDisplay.directory}
                          {selectedPathDisplay.separator}
                        </span>
                      ) : null}
                      <span className="font-medium text-fg">{selectedPathDisplay.filename}</span>
                    </div>
                    {selectedFile.previousPath ? (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
                        from {selectedFile.previousPath}
                      </div>
                    ) : null}
                    {filePaneStatus ? (
                      <div
                        className="tm-diff-status tm-fade-in"
                        data-tone={filePaneStatus.tone}
                        key={filePaneStatus.message}
                      >
                        <span>{filePaneStatus.message}</span>
                        {selectedFileAdditions ? (
                          <span className="font-mono text-positive">{selectedFileAdditions}</span>
                        ) : null}
                        {selectedFileDeletions ? (
                          <span className="font-mono text-danger">{selectedFileDeletions}</span>
                        ) : null}
                        {selectedFileChangeLabel ? (
                          <span className={`font-mono ${selectedFileChangeLabel.className}`}>
                            {selectedFileChangeLabel.text}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Presence motion="fade" show={fileEditable}>
                      {selectedFileState ? (
                        <div className="flex items-center gap-2">
                          <Button
                            disabled={
                              !selectedFileDirty || selectedFileState.saveStatus === 'saving'
                            }
                            onClick={handleRevertFile}
                            size="sm"
                            title="Discard unsaved changes"
                            variant="ghost"
                          >
                            Revert
                          </Button>
                          <Button
                            disabled={
                              !selectedFileDirty || selectedFileState.saveStatus === 'saving'
                            }
                            onClick={handleSaveFile}
                            size="sm"
                            title="Save file"
                            variant="primary"
                          >
                            Save
                          </Button>
                        </div>
                      ) : null}
                    </Presence>

                    <div className="shrink-0">
                      <SegmentedControl<FilePaneMode>
                        ariaLabel="Selected file view"
                        onChange={setFilePaneMode}
                        options={FILE_PANE_OPTIONS}
                        value={filePaneMode}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="tm-fade-in py-1 text-[12.5px] text-fg-muted">
                  Pick a changed file to inspect its diff.
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto" ref={diffPaneRef}>
              {/* Each state is keyed so switching files or states fades the new content in. */}
              {!selectedFile ? null : filePaneMode === 'patch' ? (
                activePatchState.status === 'loading' ? (
                  <div className="tm-diff-message tm-fade-in" key="patch-loading" role="status">
                    Loading diff…
                  </div>
                ) : activePatchState.status === 'error' ? (
                  <div className="tm-diff-message tm-fade-in" data-tone="danger" key="patch-error">
                    {activePatchState.error}
                  </div>
                ) : activePatchState.status === 'ready' && parsedDiffs.length > 0 ? (
                  <div
                    className={`tm-diff-view tm-diff-view--${diffViewType} tm-fade-in`}
                    key={`patch:${patchKey}`}
                  >
                    {parsedDiffs.map((file) => (
                      <div
                        className="tm-diff-hunks"
                        key={`${file.oldPath}:${file.newPath}:${file.type}`}
                      >
                        <Diff
                          codeClassName="text-[12.5px]"
                          codeEvents={patchCodeEvents}
                          diffType={file.type}
                          gutterClassName="text-[11.5px]"
                          gutterType="anchor"
                          hunks={file.hunks}
                          viewType={diffViewType}
                        >
                          {(hunks) => renderPatchHunks(file.type, hunks)}
                        </Diff>
                      </div>
                    ))}
                    <LineJumpButton onJump={handleJumpToFileLine} target={hoverJumpTarget} />
                  </div>
                ) : activePatchState.status === 'ready' ? (
                  <div className="tm-diff-message tm-fade-in" key="patch-empty">
                    {activePatchState.isBinary
                      ? 'Binary diff ready, but there is no text patch to render.'
                      : 'No text patch was returned for this file.'}
                  </div>
                ) : null
              ) : selectedFileState?.status === 'loading' || !selectedFileState ? (
                <div className="tm-diff-message tm-fade-in" key="file-loading" role="status">
                  Loading file…
                </div>
              ) : selectedFileState.status === 'error' ? (
                <div className="tm-diff-message tm-fade-in" data-tone="danger" key="file-error">
                  {selectedFileState.error}
                </div>
              ) : (
                <div className="tm-fade-in h-full" key={`file:${fileContentKey}`}>
                  <MonacoFileEditor
                    key={fileContentKey}
                    modelKey={fileContentKey ?? selectedFile.path}
                    onChange={handleFileContentChange}
                    path={selectedFile.path}
                    readOnly={selectedFileReadOnly || selectedFileState.saveStatus === 'saving'}
                    revealTarget={fileRevealTarget}
                    value={selectedFileState.content}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * The "open file at this line" button, portaled into the hovered diff cell. It pops in on
 * hover and fades out from the cell it was in when the pointer leaves.
 */
function LineJumpButton({
  target,
  onJump
}: {
  target: HoverJumpTarget | null
  onJump: (lineNumber: number) => void
}): React.ReactPortal | null {
  const live = target?.cell.isConnected ? target : null
  const { mounted, state } = usePresence(Boolean(live))
  const last = useLastValue(live)
  const shown = live ?? last
  if (!mounted || !shown || !shown.cell.isConnected) return null
  return createPortal(
    <button
      aria-label={`Open file at line ${shown.lineNumber}`}
      className="tm-diff-line-jump"
      data-motion="fade"
      data-state={state}
      key={shown.lineNumber}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onJump(shown.lineNumber)
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      title={`Open file at line ${shown.lineNumber}`}
      type="button"
    >
      <ArrowRightIcon height={12} width={12} />
    </button>,
    shown.cell
  )
}
