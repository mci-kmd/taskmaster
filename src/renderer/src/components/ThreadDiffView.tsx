import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import type {
  ThreadDiffFileSummary,
  ThreadDiffMode,
  ThreadDiffPatchRequest,
  ThreadDiffQuery,
  ThreadDiffRangeOption,
  ThreadDiffRangeOptions,
  ThreadSnapshot
} from '../../../shared/app-types'
import { RefreshIcon } from './Icons'
import ResizeHandle from './ResizeHandle'
import Button from './ui/Button'
import { Field, Select } from './ui/Field'
import SegmentedControl from './ui/SegmentedControl'

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

const DIFF_SPLIT_MIN_WIDTH_PX = 1320
const FILE_LIST_WIDTH_DEFAULT = 380
const FILE_LIST_WIDTH_MIN = 220
const FILE_LIST_WIDTH_MAX = 560
const DIFF_CONTENT_WIDTH_MIN = 480
const DIFF_PANE_GAP_PX = 12

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

function getRangeOptionLabel(
  value: string,
  optionMap: Map<string, ThreadDiffRangeOption>
): string {
  return optionMap.get(value)?.label ?? value
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
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
    if (!query) {
      return JSON.stringify(['pending-range', thread.id, mode, refreshToken])
    }

    return JSON.stringify([
      query.threadId,
      query.mode,
      query.baseRef ?? null,
      query.headRef ?? null,
      refreshToken
    ])
  }, [mode, query, refreshToken, thread.id])

  useEffect(() => {
    let cancelled = false
    setRangeOptionsState({
      status: 'loading',
      options: null,
      error: null
    })
    setSelectedRange({
      baseRef: '',
      headRef: ''
    })

    void window.api.appState
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

    void window.api.appState
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

  const patchKey = selectedFile ? `${requestKey}:${selectedFile.path}` : null
  const selectedPatchState = patchKey ? (patchStates[patchKey] ?? null) : null
  const summaryLoading =
    (mode === 'range' && !query && rangeOptionsState.status === 'loading') ||
    (!!query && loadedSummaryKey !== requestKey && summaryState.status !== 'error')

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

    void window.api.appState
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

  return (
    <div className="tm-fade-in flex h-full min-h-0 flex-col gap-3">
      <section className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-[218px]">
            <SegmentedControl<ThreadDiffMode>
              ariaLabel="Diff scope"
              onChange={setMode}
              options={DIFF_MODE_OPTIONS}
              value={mode}
            />
          </div>

          {mode === 'range' ? (
            <>
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
                    onChange={(event) =>
                      setSelectedRange((current) => ({
                        ...current,
                        baseRef: event.target.value
                      }))
                    }
                    value={selectedRange.baseRef}
                  >
                    {rangeOptions?.baseOptions.map((option) => (
                      <option
                        key={option.value}
                        title={option.description ?? undefined}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </Select>
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
                    onChange={(event) =>
                      setSelectedRange((current) => ({
                        ...current,
                        headRef: event.target.value
                      }))
                    }
                    value={selectedRange.headRef}
                  >
                    {rangeOptions?.headOptions.map((option) => (
                      <option
                        key={option.value}
                        title={option.description ?? undefined}
                        value={option.value}
                      >
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                Scope
              </div>
              <div className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
                Includes tracked and untracked changes in{' '}
                <span className="font-mono">{thread.cwd}</span>.
              </div>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="text-right">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                Diff set
              </div>
              <div className="mt-1 text-[12.5px] font-mono text-[var(--color-fg-muted)]">
                {summaryLabel}
              </div>
            </div>
            <Button onClick={handleRefresh} size="sm" title="Refresh diffs" variant="secondary">
              <RefreshIcon width={11} height={11} />
              Refresh
            </Button>
          </div>
        </div>

        {mode === 'range' && rangeOptionsState.status === 'loading' ? (
          <div className="mt-3 text-[12.5px] text-[var(--color-fg-muted)]">
            Loading branch commits...
          </div>
        ) : null}

        {mode === 'range' && rangeOptionsState.status === 'error' ? (
          <div className="mt-3 text-[12.5px] text-[var(--color-danger)]">
            {rangeOptionsState.error}
          </div>
        ) : null}
      </section>

      {panelError ? (
        <section className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-6">
          <div className="max-w-md text-center">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-danger)]">
              Diff load failed
            </div>
            <p className="mt-3 text-[13px] leading-6 text-[var(--color-fg-muted)]">
              {panelError}
            </p>
          </div>
        </section>
      ) : null}

      {!panelError ? (
        <div className="flex min-h-0 flex-1" ref={paneContainerRef}>
          <div className="relative flex shrink-0" style={{ width: currentFileListWidth }}>
            <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <div className="border-b border-[var(--color-border)] px-4 py-3">
                <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                  Changed files
                </div>
                <div className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
                  {summaryState.files.length} file{summaryState.files.length === 1 ? '' : 's'}
                  {summaryLoading ? ' · Refreshing…' : ''}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {summaryLoading && summaryState.files.length === 0 ? (
                  <div className="px-3 py-5 text-[12.5px] text-[var(--color-fg-muted)]">
                    Loading changed files…
                  </div>
                ) : null}

                {summaryState.status === 'ready' && summaryState.files.length === 0 ? (
                  <div className="px-3 py-5 text-[12.5px] leading-6 text-[var(--color-fg-muted)]">
                    No diffs in this scope.
                  </div>
                ) : null}

                {summaryState.files.map((file) => {
                  const additions = formatStatDelta('+', file.additions)
                  const deletions = formatStatDelta('-', file.deletions)
                  const active = file.path === selectedPath
                  const showNewLabel = file.status === 'untracked'
                  const pathDisplay = splitPathForDisplay(file.path)
                  const tooltip =
                    file.previousPath !== null && file.previousPath.length > 0
                      ? `${file.path}\nfrom ${file.previousPath}`
                      : file.path

                  return (
                    <button
                      className={`mb-[2px] w-full rounded-md border px-[6px] py-[5px] text-left transition-colors ${
                        active
                          ? 'border-[var(--color-border-strong)] bg-[var(--color-surface)]'
                          : 'border-transparent bg-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                      }`}
                      key={`${file.previousPath ?? ''}:${file.path}`}
                      onClick={() => setSelectedPath(file.path)}
                      title={tooltip}
                      type="button"
                    >
                      <div className="min-w-0">
                        <div className="inline-flex min-w-0 max-w-full font-mono text-[12.5px]">
                          {pathDisplay.directory ? (
                            <span className="tm-truncate-start min-w-0 flex-1 text-[var(--color-fg-subtle)]">
                              {pathDisplay.directory}
                            </span>
                          ) : null}
                          {pathDisplay.separator ? (
                            <span className="shrink-0 text-[var(--color-fg-subtle)]">
                              {pathDisplay.separator}
                            </span>
                          ) : null}
                          <span className="truncate text-[var(--color-fg)]">
                            {pathDisplay.filename}
                          </span>
                        </div>
                        {file.previousPath ? (
                          <div className="tm-truncate-start mt-[2px] font-mono text-[11.5px] text-[var(--color-fg-subtle)]">
                            from {file.previousPath}
                          </div>
                        ) : null}
                        {additions || deletions || showNewLabel ? (
                          <div className="mt-[2px] flex items-center gap-1 text-[11.5px] font-mono">
                            {additions ? (
                              <span className="text-[var(--color-positive)]">{additions}</span>
                            ) : null}
                            {deletions ? (
                              <span className="text-[var(--color-danger)]">{deletions}</span>
                            ) : null}
                            {showNewLabel ? (
                              <span className="text-[var(--color-positive)]">New</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>

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

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              {selectedFile ? (
                <>
                  <div className="truncate font-mono text-[13px] text-[var(--color-fg)]">
                    {selectedFile.path}
                  </div>
                  {selectedFile.previousPath ? (
                    <div className="mt-1 truncate font-mono text-[11.5px] text-[var(--color-fg-subtle)]">
                      from {selectedFile.previousPath}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-[12.5px] text-[var(--color-fg-muted)]">
                  Pick a changed file to inspect its diff.
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto" ref={diffPaneRef}>
              {!selectedFile ? null : activePatchState.status === 'loading' ? (
                <div className="px-5 py-6 text-[12.5px] text-[var(--color-fg-muted)]">
                  Loading diff…
                </div>
              ) : activePatchState.status === 'error' ? (
                <div className="px-5 py-6 text-[12.5px] leading-6 text-[var(--color-danger)]">
                  {activePatchState.error}
                </div>
              ) : activePatchState.status === 'ready' && parsedDiffs.length > 0 ? (
                <div
                  className={`tm-diff-view tm-diff-view--${diffViewType} overflow-auto px-4 py-4`}
                >
                  {parsedDiffs.map((file) => (
                    <Diff
                      codeClassName="text-[12.5px]"
                      diffType={file.type}
                      gutterClassName="text-[11.5px]"
                      gutterType="anchor"
                      hunks={file.hunks}
                      key={`${file.oldPath}:${file.newPath}:${file.type}`}
                      viewType={diffViewType}
                    >
                      {(hunks) => hunks.map((hunk) => <Hunk hunk={hunk} key={hunk.content} />)}
                    </Diff>
                  ))}
                </div>
              ) : activePatchState.status === 'ready' ? (
                <div className="px-5 py-6 text-[12.5px] leading-6 text-[var(--color-fg-muted)]">
                  {activePatchState.isBinary
                    ? 'Binary diff ready, but there is no text patch to render.'
                    : 'No text patch was returned for this file.'}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
