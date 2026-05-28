import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import type {
  RepositoryBackend,
  ThreadDiffFileContentRequest,
  ThreadDiffFileContentResult,
  ThreadDiffFileSummary,
  ThreadDiffFileSaveRequest,
  ThreadDiffFileSaveResult,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult
} from '../../../shared/app-types'
import { THREAD_DIFF_WORKTREE_REF } from '../../../shared/app-types'
import { tryGit, tryGitAsync } from '../../backends/git-client'
import {
  backendPathExists,
  buildNativeCommand,
  resolvePath,
  spawnBackendCommand,
  toUiPath
} from '../../backends/repository-backend'
import { isPathInsideRepository } from '../repositories/repository-path-utils'
import type { ThreadGitContext } from '../threads/thread-git-context'
import {
  annotateDiffFilesWithProjects,
  buildCommitOption,
  buildDiffStatMap,
  buildUntrackedDiffFiles,
  buildWorkingTreeDiffFiles,
  getGitDiffStat,
  getGitStatus,
  getWorkingTreeDiffBase,
  hasHeadCommit,
  isWorkingTreeRef,
  parseCommitLines,
  parseNameStatusOutput,
  readCommitOption
} from './thread-diff-helpers'

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

type TextFileMetadata = {
  content: string
  hasUtf8Bom: boolean
  lineEnding: 'lf' | 'crlf'
  revisionToken: string
}

type TextFileReadResult = { ok: true; file: TextFileMetadata } | { ok: false; error: string }
type RawGitResult = { ok: true; stdout: Buffer } | { ok: false; error: string }

function createRevisionToken(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function buildUnavailableTextFileError(detail: string): string {
  return `${detail} Monaco file view supports UTF-8 text files up to 2 MB.`
}

function decodeTextFileBuffer(buffer: Buffer, path: string): TextFileReadResult {
  if (buffer.byteLength > MAX_TEXT_FILE_BYTES) {
    return {
      ok: false,
      error: buildUnavailableTextFileError(`"${path}" is too large to display.`)
    }
  }

  if (buffer.includes(0)) {
    return {
      ok: false,
      error: buildUnavailableTextFileError(`"${path}" appears to be a binary file.`)
    }
  }

  const hasUtf8Bom = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
  const textBuffer = hasUtf8Bom ? buffer.subarray(UTF8_BOM.length) : buffer

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(textBuffer)
    return {
      ok: true,
      file: {
        content: decoded.replace(/\r\n/g, '\n'),
        hasUtf8Bom,
        lineEnding: decoded.includes('\r\n') ? 'crlf' : 'lf',
        revisionToken: createRevisionToken(buffer)
      }
    }
  } catch {
    return {
      ok: false,
      error: buildUnavailableTextFileError(`"${path}" is not valid UTF-8 text.`)
    }
  }
}

function encodeTextFileBuffer(
  content: string,
  options: Pick<TextFileMetadata, 'hasUtf8Bom' | 'lineEnding'>
): Buffer {
  const normalized = content.replace(/\r\n?/g, '\n')
  const text = options.lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  const body = Buffer.from(text, 'utf8')
  return options.hasUtf8Bom ? Buffer.concat([UTF8_BOM, body]) : body
}

function resolveThreadDiffFilePath(
  cwd: string,
  backend: RepositoryBackend,
  path: string
): { ok: true; executionPath: string; uiPath: string } | { ok: false; error: string } {
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    return { ok: false, error: 'Diff path is required.' }
  }

  const executionPath = resolvePath(backend, cwd, trimmedPath)
  if (!isPathInsideRepository(cwd, executionPath, backend)) {
    return { ok: false, error: 'Diff path must stay inside the thread working directory.' }
  }

  return {
    ok: true,
    executionPath,
    uiPath: toUiPath(backend, executionPath)
  }
}

function readWorkingTreeTextFile(
  cwd: string,
  backend: RepositoryBackend,
  path: string
): TextFileReadResult {
  const resolved = resolveThreadDiffFilePath(cwd, backend, path)
  if (!resolved.ok) {
    return resolved
  }

  if (!backendPathExists(backend, resolved.executionPath, 'file')) {
    return { ok: false, error: `Current file not found: ${path}` }
  }

  try {
    return decodeTextFileBuffer(readFileSync(resolved.uiPath), path)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function readGitBlob(
  cwd: string,
  backend: RepositoryBackend,
  ref: string,
  path: string
): Promise<RawGitResult> {
  return new Promise((resolve) => {
    const child = spawnBackendCommand(
      backend,
      buildNativeCommand('git', ['-C', cwd, 'show', `${ref}:${path.replaceAll('\\', '/')}`]),
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const stdoutChunks: Buffer[] = []
    let stderr = ''
    let settled = false
    const finish = (result: RawGitResult): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      finish({ ok: false, error: error.message })
    })

    child.on('close', (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          error: stderr.trim() || `Unable to read "${path}" from ${ref}.`
        })
        return
      }

      finish({ ok: true, stdout: Buffer.concat(stdoutChunks) })
    })
  })
}

async function buildUntrackedFilePatch(
  cwd: string,
  path: string,
  backend: RepositoryBackend
): Promise<ThreadDiffPatchResult> {
  const nullPath = backend.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
  const result = await tryGitAsync(
    cwd,
    ['diff', '--no-index', '--binary', '--', nullPath, path],
    backend
  )
  if (result.stdout.trim().length > 0) {
    return { ok: true, patch: result.stdout, isBinary: false }
  }

  return {
    ok: false,
    error: result.stderr || `Unable to build a patch for "${path}".`
  }
}

export function createThreadDiffService(dependencies: {
  resolveThreadGitContext: (threadId: string) => ThreadGitContext
}): {
  getThreadDiffRangeOptions: (threadId: string) => Promise<ThreadDiffRangeOptionsResult>
  getThreadDiffSummary: (input: ThreadDiffQuery) => Promise<ThreadDiffSummaryResult>
  getThreadDiffPatch: (input: ThreadDiffPatchRequest) => Promise<ThreadDiffPatchResult>
  getThreadDiffFileContent: (
    input: ThreadDiffFileContentRequest
  ) => Promise<ThreadDiffFileContentResult>
  saveThreadDiffFileContent: (input: ThreadDiffFileSaveRequest) => Promise<ThreadDiffFileSaveResult>
} {
  const getThreadDiffRangeOptions = async (
    threadId: string
  ): Promise<ThreadDiffRangeOptionsResult> => {
    const context = dependencies.resolveThreadGitContext(threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository
    if (!hasHeadCommit(cwd, backend)) {
      return { ok: false, error: 'No commits exist on this branch yet.' }
    }

    try {
      const currentBranch = tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
      const branchName =
        currentBranch.ok && currentBranch.stdout !== 'HEAD' ? currentBranch.stdout : null
      let defaultBaseRef = ''

      if (branchName) {
        const primaryBranch = tryGit(
          cwd,
          ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
          backend
        )
        const primaryName =
          primaryBranch.ok && primaryBranch.stdout
            ? primaryBranch.stdout.replace(/^origin\//, '')
            : (['main', 'master'].find(
                (candidate) =>
                  tryGit(
                    cwd,
                    ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
                    backend
                  ).ok
              ) ?? null)
        if (primaryName && branchName !== primaryName) {
          const mergeBase = tryGit(cwd, ['merge-base', primaryName, 'HEAD'], backend)
          if (mergeBase.ok && mergeBase.stdout) {
            defaultBaseRef = mergeBase.stdout
          }
        }
      }

      if (!defaultBaseRef) {
        const rootCommit = tryGit(cwd, ['rev-list', '--max-parents=0', 'HEAD'], backend)
        defaultBaseRef = rootCommit.stdout.split(/\r?\n/)[0] ?? ''
      }

      if (!defaultBaseRef) {
        return { ok: false, error: 'Unable to determine a branch base commit.' }
      }

      const baseOption = await readCommitOption(cwd, defaultBaseRef, backend, 'Branch base')
      const history = await tryGitAsync(
        cwd,
        ['log', '--reverse', '--format=%H%x1f%h%x1f%s', `${defaultBaseRef}..HEAD`],
        backend
      )
      if (!history.ok) {
        return { ok: false, error: history.stderr || 'Unable to read current branch history.' }
      }

      const commitOptions = [
        baseOption,
        ...parseCommitLines(history.stdout).map((commit) => buildCommitOption(commit))
      ]

      return {
        ok: true,
        options: {
          baseOptions: commitOptions,
          headOptions: [
            ...commitOptions,
            {
              value: THREAD_DIFF_WORKTREE_REF,
              label: 'Current changes',
              description: 'Working tree state on top of HEAD'
            }
          ],
          defaultBaseRef,
          defaultHeadRef: THREAD_DIFF_WORKTREE_REF
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const getRangeToWorkingTreeDiffFiles = async (
    cwd: string,
    backend: RepositoryBackend,
    baseRef: string
  ): Promise<ThreadDiffFileSummary[]> => {
    const [nameStatus, diffSummary, status] = await Promise.all([
      tryGitAsync(cwd, ['diff', '--name-status', '-z', '--find-renames', baseRef], backend),
      getGitDiffStat(cwd, [baseRef], backend),
      getGitStatus(cwd, backend)
    ])
    if (!nameStatus.ok) {
      throw new Error(nameStatus.stderr || 'Unable to read git diff.')
    }

    const trackedFiles = parseNameStatusOutput(nameStatus.stdout, buildDiffStatMap(diffSummary))
    const trackedByPath = new Set(trackedFiles.map((file) => file.path))
    const untrackedFiles = buildUntrackedDiffFiles(status).filter(
      (file) => !trackedByPath.has(file.path)
    )

    return [...trackedFiles, ...untrackedFiles].sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
    )
  }

  const getThreadDiffSummary = async (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository

    try {
      if (input.mode === 'range') {
        const baseRef = input.baseRef?.trim() ?? ''
        const headRef = input.headRef?.trim() ?? ''
        if (!baseRef || !headRef) {
          return { ok: false, error: 'Both range refs are required.' }
        }

        if (isWorkingTreeRef(baseRef)) {
          return { ok: false, error: 'Base ref must be a commit.' }
        }

        if (isWorkingTreeRef(headRef)) {
          return {
            ok: true,
            summary: {
              mode: input.mode,
              baseRef,
              headRef,
              files: annotateDiffFilesWithProjects(
                cwd,
                backend,
                await getRangeToWorkingTreeDiffFiles(cwd, backend, baseRef)
              )
            }
          }
        }

        const [nameStatus, diffSummary] = await Promise.all([
          tryGitAsync(
            cwd,
            ['diff', '--name-status', '-z', '--find-renames', baseRef, headRef],
            backend
          ),
          getGitDiffStat(cwd, [baseRef, headRef], backend)
        ])
        if (!nameStatus.ok) {
          throw new Error(nameStatus.stderr || 'Unable to read git diff.')
        }

        return {
          ok: true,
          summary: {
            mode: input.mode,
            baseRef,
            headRef,
            files: annotateDiffFilesWithProjects(
              cwd,
              backend,
              parseNameStatusOutput(nameStatus.stdout, buildDiffStatMap(diffSummary))
            )
          }
        }
      }

      const diffBase = getWorkingTreeDiffBase(cwd, backend)
      const [status, diffSummary] = await Promise.all([
        getGitStatus(cwd, backend),
        getGitDiffStat(cwd, [diffBase], backend)
      ])

      return {
        ok: true,
        summary: {
          mode: input.mode,
          baseRef: null,
          headRef: null,
          files: annotateDiffFilesWithProjects(
            cwd,
            backend,
            buildWorkingTreeDiffFiles(status, buildDiffStatMap(diffSummary))
          )
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const getThreadDiffPatch = async (
    input: ThreadDiffPatchRequest
  ): Promise<ThreadDiffPatchResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository
    const trimmedPath = input.path.trim()
    if (!trimmedPath) {
      return { ok: false, error: 'Diff path is required.' }
    }

    const resolvedPath = resolvePath(backend, cwd, trimmedPath)
    if (!isPathInsideRepository(cwd, resolvedPath, backend)) {
      return { ok: false, error: 'Diff path must stay inside the thread working directory.' }
    }

    if (input.status === 'untracked') {
      return buildUntrackedFilePatch(cwd, trimmedPath, backend)
    }

    const previousPath = input.previousPath?.trim() ?? ''
    const pathspec =
      previousPath && previousPath !== trimmedPath ? [previousPath, trimmedPath] : [trimmedPath]

    try {
      const baseRef = input.baseRef?.trim() ?? ''
      const headRef = input.headRef?.trim() ?? ''
      if (input.mode === 'range' && (!baseRef || !headRef)) {
        return { ok: false, error: 'Both range refs are required.' }
      }
      if (input.mode === 'range' && isWorkingTreeRef(baseRef)) {
        return { ok: false, error: 'Base ref must be a commit.' }
      }

      const patch =
        input.mode === 'range'
          ? isWorkingTreeRef(headRef)
            ? await tryGitAsync(
                cwd,
                ['diff', '--patch', '--binary', '--find-renames', baseRef, '--', ...pathspec],
                backend
              )
            : await tryGitAsync(
                cwd,
                [
                  'diff',
                  '--patch',
                  '--binary',
                  '--find-renames',
                  baseRef,
                  headRef,
                  '--',
                  ...pathspec
                ],
                backend
              )
          : await tryGitAsync(
              cwd,
              [
                'diff',
                '--patch',
                '--binary',
                '--find-renames',
                getWorkingTreeDiffBase(cwd, backend),
                '--',
                ...pathspec
              ],
              backend
            )

      if (!patch.ok) {
        return { ok: false, error: patch.stderr || 'Unable to build diff patch.' }
      }

      return {
        ok: true,
        patch: patch.stdout,
        isBinary: patch.stdout.includes('GIT binary patch') || patch.stdout.includes('Binary files')
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const getThreadDiffFileContent = async (
    input: ThreadDiffFileContentRequest
  ): Promise<ThreadDiffFileContentResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository
    const trimmedPath = input.path.trim()
    if (!trimmedPath) {
      return { ok: false, error: 'Diff path is required.' }
    }

    const resolved = resolveThreadDiffFilePath(cwd, backend, trimmedPath)
    if (!resolved.ok) {
      return resolved
    }

    if (input.status === 'deleted') {
      return { ok: false, error: 'Deleted files do not have current file content.' }
    }

    if (input.mode === 'range') {
      const baseRef = input.baseRef?.trim() ?? ''
      const headRef = input.headRef?.trim() ?? ''
      if (!baseRef || !headRef) {
        return { ok: false, error: 'Both range refs are required.' }
      }
      if (isWorkingTreeRef(baseRef)) {
        return { ok: false, error: 'Base ref must be a commit.' }
      }

      if (isWorkingTreeRef(headRef)) {
        const file = readWorkingTreeTextFile(cwd, backend, trimmedPath)
        return file.ok
          ? { ok: true, content: file.file.content, revisionToken: file.file.revisionToken }
          : file
      }

      const result = await readGitBlob(cwd, backend, headRef, trimmedPath)
      if (!result.ok) {
        return { ok: false, error: result.error }
      }

      const file = decodeTextFileBuffer(result.stdout, trimmedPath)
      return file.ok
        ? { ok: true, content: file.file.content, revisionToken: file.file.revisionToken }
        : file
    }

    const file = readWorkingTreeTextFile(cwd, backend, trimmedPath)
    return file.ok
      ? { ok: true, content: file.file.content, revisionToken: file.file.revisionToken }
      : file
  }

  const saveThreadDiffFileContent = async (
    input: ThreadDiffFileSaveRequest
  ): Promise<ThreadDiffFileSaveResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    if (input.mode !== 'working-tree') {
      return { ok: false, error: 'Editing is only allowed in the uncommitted diff scope.' }
    }

    if (input.status === 'deleted') {
      return { ok: false, error: 'Deleted files cannot be edited.' }
    }

    const { cwd } = context
    const { backend } = context.repository
    const trimmedPath = input.path.trim()
    const resolved = resolveThreadDiffFilePath(cwd, backend, trimmedPath)
    if (!resolved.ok) {
      return resolved
    }

    if (!backendPathExists(backend, resolved.executionPath, 'file')) {
      return { ok: false, error: `Current file not found: ${trimmedPath}` }
    }

    let currentFile: TextFileReadResult
    try {
      currentFile = decodeTextFileBuffer(readFileSync(resolved.uiPath), trimmedPath)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }

    if (!currentFile.ok) {
      return currentFile
    }

    if (currentFile.file.revisionToken !== input.expectedRevisionToken) {
      return { ok: false, error: 'File changed on disk. Reload before saving.' }
    }

    const outputBuffer = encodeTextFileBuffer(input.content, currentFile.file)
    if (outputBuffer.byteLength > MAX_TEXT_FILE_BYTES) {
      return {
        ok: false,
        error: buildUnavailableTextFileError(`"${trimmedPath}" is too large to save.`)
      }
    }

    try {
      writeFileSync(resolved.uiPath, outputBuffer)
      return {
        ok: true,
        revisionToken: createRevisionToken(outputBuffer)
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  return {
    getThreadDiffRangeOptions,
    getThreadDiffSummary,
    getThreadDiffPatch,
    getThreadDiffFileContent,
    saveThreadDiffFileContent
  }
}
