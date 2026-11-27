import { execFile } from 'child_process'
import type { ThreadWorkItem } from '../../../shared/app-types'

const COMMAND_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 15_000
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798'
const ADO_TOKEN_BUFFER_MS = 60_000
const ADO_TOKEN_FALLBACK_TTL_MS = 5 * 60_000
const ADO_STATES_CACHE_TTL_MS = 60 * 60_000
const COMPLETED_ADO_STATES = new Set(['closed', 'done', 'completed'])
const SAFE_ADO_ORG_PATTERN = /^[A-Za-z0-9._-]+$/u

export type CommandOutput = {
  ok: boolean
  stdout: string
  errorCode?: string
}

export type WorkItemStatusDependencies = {
  runCommand?: (
    file: string,
    args: string[],
    options?: { shell?: boolean; timeoutMs?: number }
  ) => Promise<CommandOutput>
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  now?: () => number
  platform?: NodeJS.Platform
}

function defaultRunCommand(
  file: string,
  args: string[],
  options: { shell?: boolean; timeoutMs?: number } = {}
): Promise<CommandOutput> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        shell: options.shell === true,
        timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code
          resolve({ ok: false, stdout: typeof stdout === 'string' ? stdout : '', errorCode: code })
          return
        }
        resolve({ ok: true, stdout: typeof stdout === 'string' ? stdout : '' })
      }
    )
  })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseGitHubCompleted(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') return null
  const state = (body as { state?: unknown }).state
  if (typeof state !== 'string' || !state.trim()) return null
  return state.trim().toLowerCase() === 'closed'
}

function parseAdoWorkItemFields(
  body: unknown
): { state: string; workItemType: string | null } | null {
  if (!body || typeof body !== 'object') return null
  const fields = (body as { fields?: unknown }).fields
  if (!fields || typeof fields !== 'object') return null
  const record = fields as Record<string, unknown>
  const state = typeof record['System.State'] === 'string' ? record['System.State'].trim() : ''
  if (!state) return null
  const workItemType =
    typeof record['System.WorkItemType'] === 'string' && record['System.WorkItemType'].trim()
      ? record['System.WorkItemType'].trim()
      : null
  return { state, workItemType }
}

function isCompletedAdoStateName(state: string): boolean {
  return COMPLETED_ADO_STATES.has(state.trim().toLowerCase())
}

function parseAdoTokenExpiry(body: Record<string, unknown>, nowMs: number): number {
  const epochSeconds = Number(body.expires_on)
  if (Number.isFinite(epochSeconds) && epochSeconds > 0) return epochSeconds * 1000
  if (typeof body.expiresOn === 'string') {
    const parsed = Date.parse(body.expiresOn)
    if (Number.isFinite(parsed)) return parsed
  }
  return nowMs + ADO_TOKEN_FALLBACK_TTL_MS
}

export function createWorkItemStatusChecker(dependencies: WorkItemStatusDependencies = {}): {
  /** Returns true when completed, false when still open, or null when status couldn't be fetched. */
  isCompleted: (item: ThreadWorkItem) => Promise<boolean | null>
} {
  const runCommand = dependencies.runCommand ?? defaultRunCommand
  const fetchImpl = dependencies.fetch ?? fetch
  const env = dependencies.env ?? process.env
  const now = dependencies.now ?? Date.now
  const platform = dependencies.platform ?? process.platform

  let cachedAdoToken: { token: string; expiresAtMs: number } | null = null
  const adoStateCategoriesCache = new Map<
    string,
    { expiresAtMs: number; categories: Map<string, string> }
  >()

  async function checkGitHub(item: ThreadWorkItem): Promise<boolean | null> {
    const endpoint = `repos/${item.container}/issues/${item.number}`
    const cli = await runCommand('gh', ['api', endpoint])
    if (cli.ok) {
      return parseGitHubCompleted(parseJson(cli.stdout))
    }
    if (cli.errorCode !== 'ENOENT') {
      return null
    }
    try {
      const token = env.GH_TOKEN || env.GITHUB_TOKEN
      const response = await fetchImpl(`https://api.github.com/${endpoint}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) return null
      return parseGitHubCompleted(await response.json())
    } catch {
      return null
    }
  }

  async function getAdoAuthHeader(forceRefresh = false): Promise<{
    header: string
    fromCliToken: boolean
  } | null> {
    const pat = env.AZURE_DEVOPS_EXT_PAT || env.ADO_PAT
    if (pat) {
      return {
        header: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
        fromCliToken: false
      }
    }
    if (
      !forceRefresh &&
      cachedAdoToken &&
      now() < cachedAdoToken.expiresAtMs - ADO_TOKEN_BUFFER_MS
    ) {
      return { header: `Bearer ${cachedAdoToken.token}`, fromCliToken: true }
    }
    const cli = await runCommand(
      'az',
      ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '--output', 'json'],
      { shell: platform === 'win32' }
    )
    if (!cli.ok) return null
    const parsed = parseJson(cli.stdout)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    const token = typeof record.accessToken === 'string' ? record.accessToken.trim() : ''
    if (!token) return null
    cachedAdoToken = { token, expiresAtMs: parseAdoTokenExpiry(record, now()) }
    return { header: `Bearer ${token}`, fromCliToken: true }
  }

  async function getAdoStateCategories(
    organization: string,
    project: string,
    workItemType: string,
    authHeader: string
  ): Promise<Map<string, string> | null> {
    const cacheKey = `${organization.toLowerCase()}/${project.toLowerCase()}/${workItemType.toLowerCase()}`
    const cached = adoStateCategoriesCache.get(cacheKey)
    if (cached && now() < cached.expiresAtMs) return cached.categories
    try {
      const url =
        `https://dev.azure.com/${encodeURIComponent(organization)}/` +
        `${encodeURIComponent(project)}/_apis/wit/workitemtypes/` +
        `${encodeURIComponent(workItemType)}/states?api-version=7.1`
      const response = await fetchImpl(url, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) return null
      const body = (await response.json()) as { value?: unknown }
      if (!Array.isArray(body?.value)) return null
      const categories = new Map<string, string>()
      for (const entry of body.value) {
        if (!entry || typeof entry !== 'object') continue
        const { name, category } = entry as { name?: unknown; category?: unknown }
        if (typeof name === 'string' && typeof category === 'string') {
          categories.set(name.trim().toLowerCase(), category.trim().toLowerCase())
        }
      }
      if (categories.size === 0) return null
      adoStateCategoriesCache.set(cacheKey, {
        expiresAtMs: now() + ADO_STATES_CACHE_TTL_MS,
        categories
      })
      return categories
    } catch {
      return null
    }
  }

  async function checkAzureDevOps(item: ThreadWorkItem): Promise<boolean | null> {
    const slash = item.container.indexOf('/')
    if (slash <= 0 || slash === item.container.length - 1) return null
    const organization = item.container.slice(0, slash)
    const project = item.container.slice(slash + 1)

    let auth = await getAdoAuthHeader()
    if (auth) {
      const workItemUrl =
        `https://dev.azure.com/${encodeURIComponent(organization)}/` +
        `${encodeURIComponent(project)}/_apis/wit/workitems/${item.number}` +
        '?fields=System.State,System.WorkItemType&api-version=7.1'
      try {
        let response = await fetchImpl(workItemUrl, {
          headers: { Authorization: auth.header, Accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        })
        if (response.status === 401 && auth.fromCliToken) {
          cachedAdoToken = null
          auth = await getAdoAuthHeader(true)
          if (auth) {
            response = await fetchImpl(workItemUrl, {
              headers: { Authorization: auth.header, Accept: 'application/json' },
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
            })
          }
        }
        if (response.ok) {
          const parsed = parseAdoWorkItemFields(await response.json())
          if (!parsed) return null
          if (parsed.workItemType && auth) {
            const categories = await getAdoStateCategories(
              organization,
              project,
              parsed.workItemType,
              auth.header
            )
            const category = categories?.get(parsed.state.toLowerCase())
            if (category) return category === 'completed'
          }
          return isCompletedAdoStateName(parsed.state)
        }
        return null
      } catch {
        return null
      }
    }

    // Fallback for users signed into the az devops extension without an Entra ID token.
    if (!SAFE_ADO_ORG_PATTERN.test(organization)) return null
    const cli = await runCommand(
      'az',
      [
        'boards',
        'work-item',
        'show',
        '--id',
        String(item.number),
        '--org',
        `https://dev.azure.com/${organization}`,
        '--output',
        'json'
      ],
      { shell: platform === 'win32' }
    )
    if (!cli.ok) return null
    const parsed = parseAdoWorkItemFields(parseJson(cli.stdout))
    return parsed ? isCompletedAdoStateName(parsed.state) : null
  }

  return {
    isCompleted: (item: ThreadWorkItem): Promise<boolean | null> => {
      if (item.provider === 'github') return checkGitHub(item)
      if (item.provider === 'azure-devops') return checkAzureDevOps(item)
      return Promise.resolve(null)
    }
  }
}
