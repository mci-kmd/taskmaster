import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'
import { app } from 'electron'
import { CopilotClient as BundledCopilotClient } from '@github/copilot-sdk'
import type { CopilotSdkStatus, CopilotSdkUpdateBlocker } from '../../shared/app-types'

const BUNDLED_VERSION = '1.0.14'
const SUPPORTED_MAJOR = 1
const REGISTRY_URL = 'https://registry.npmjs.org/@github%2Fcopilot-sdk/latest'

type CopilotSdkModule = {
  CopilotClient: typeof BundledCopilotClient
}

type ActiveSdk = {
  version: string
}

function runtimePlatform(): string {
  if (process.platform === 'linux') {
    const report = process.report?.getReport() as
      { header?: { glibcVersionRuntime?: unknown } } | undefined
    const isMusl = report?.header?.glibcVersionRuntime === undefined
    return `${isMusl ? 'linuxmusl' : 'linux'}-${process.arch}`
  }
  return `${process.platform}-${process.arch}`
}

function runtimeExecutableName(): string {
  return process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime'
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) return left.localeCompare(right)

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }
  return 0
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function runNpmInstall(targetDirectory: string, version: string): Promise<void> {
  const require = createRequire(import.meta.url)
  const Arborist = require('@npmcli/arborist') as new (options: {
    path: string
    audit: boolean
    fund: boolean
  }) => {
    reify: (options: { add: string[]; saveType: 'prod'; omit: string[] }) => Promise<unknown>
  }
  const arborist = new Arborist({
    path: targetDirectory,
    audit: false,
    fund: false
  })
  return arborist
    .reify({
      add: [`@github/copilot-sdk@${version}`],
      saveType: 'prod',
      omit: ['dev']
    })
    .then(() => undefined)
}

export class CopilotSdkManager {
  private latestVersion: string | null = null
  private updateState: CopilotSdkStatus['updateState'] = 'idle'
  private updateError: string | null = null
  private authenticated: boolean | null = null
  private authLabel: string | null = null
  private runtimeVersion: string | null = null
  private blockingThreads: CopilotSdkUpdateBlocker[] = []
  private onStatusChanged: (status: CopilotSdkStatus) => void = () => undefined

  setStatusListener(listener: (status: CopilotSdkStatus) => void): void {
    this.onStatusChanged = listener
  }

  private get installRoot(): string {
    return join(app.getPath('userData'), 'copilot-sdk')
  }

  private get activePath(): string {
    return join(this.installRoot, 'active.json')
  }

  private async readActiveSdk(): Promise<ActiveSdk | null> {
    try {
      const parsed = JSON.parse(await readFile(this.activePath, 'utf8')) as Partial<ActiveSdk>
      if (!parsed.version || !parseVersion(parsed.version)) return null
      const version = parseVersion(parsed.version)
      if (
        !version ||
        version[0] !== SUPPORTED_MAJOR ||
        compareVersions(parsed.version, BUNDLED_VERSION) <= 0
      ) {
        return null
      }
      const entry = this.getManagedEntry(parsed.version)
      return (await pathExists(entry)) ? { version: parsed.version } : null
    } catch {
      return null
    }
  }

  private getManagedDirectory(version: string): string {
    return join(this.installRoot, 'versions', version)
  }

  private getManagedEntry(version: string): string {
    return join(
      this.getManagedDirectory(version),
      'node_modules',
      '@github',
      'copilot-sdk',
      'dist',
      'index.js'
    )
  }

  private getRuntimePath(nodeModulesDirectory: string): string {
    const platform = runtimePlatform()
    return join(
      nodeModulesDirectory,
      '@github',
      `copilot-sdk-${platform}`,
      'prebuilds',
      platform,
      runtimeExecutableName()
    )
  }

  private getBundledRuntimePath(): string | null {
    if (!app.isPackaged) return null
    return this.getRuntimePath(join(dirname(app.getAppPath()), 'app.asar.unpacked', 'node_modules'))
  }

  private getManagedRuntimePath(version: string): string {
    return this.getRuntimePath(join(this.getManagedDirectory(version), 'node_modules'))
  }

  async getStatus(): Promise<CopilotSdkStatus> {
    const active = await this.readActiveSdk()
    const installedVersion = active?.version ?? BUNDLED_VERSION
    return {
      bundledVersion: BUNDLED_VERSION,
      installedVersion,
      latestVersion: this.latestVersion,
      source: active ? 'managed' : 'bundled',
      updateAvailable:
        this.latestVersion !== null && compareVersions(this.latestVersion, installedVersion) > 0,
      updateState: this.updateState,
      updateError: this.updateError,
      authenticated: this.authenticated,
      authLabel: this.authLabel,
      runtimeVersion: this.runtimeVersion,
      blockingThreads: this.blockingThreads.map((thread) => ({ ...thread }))
    }
  }

  async checkForUpdate(): Promise<CopilotSdkStatus> {
    this.updateState = 'checking'
    this.updateError = null
    this.blockingThreads = []
    await this.emitStatus()
    try {
      const response = await fetch(REGISTRY_URL, {
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) {
        throw new Error(`Registry request failed with status ${response.status}.`)
      }
      const payload = (await response.json()) as { version?: unknown }
      if (typeof payload.version !== 'string' || !parseVersion(payload.version)) {
        throw new Error('Registry returned an invalid SDK version.')
      }
      this.latestVersion = payload.version
      this.updateState = 'idle'
    } catch (error) {
      this.updateState = 'error'
      this.updateError = error instanceof Error ? error.message : String(error)
    }
    return this.emitStatus()
  }

  async installLatest(): Promise<CopilotSdkStatus> {
    this.blockingThreads = []
    if (!this.latestVersion) {
      await this.checkForUpdate()
    }
    if (!this.latestVersion) return this.getStatus()

    const parsed = parseVersion(this.latestVersion)
    if (!parsed || parsed[0] !== SUPPORTED_MAJOR) {
      this.updateState = 'error'
      this.updateError = `SDK ${this.latestVersion} requires a Taskmaster compatibility update.`
      return this.emitStatus()
    }

    this.updateState = 'installing'
    this.updateError = null
    await this.emitStatus()
    try {
      const targetDirectory = this.getManagedDirectory(this.latestVersion)
      await mkdir(targetDirectory, { recursive: true })
      await writeFile(
        join(targetDirectory, 'package.json'),
        `${JSON.stringify({ private: true }, null, 2)}\n`,
        'utf8'
      )
      await runNpmInstall(targetDirectory, this.latestVersion)
      await mkdir(this.installRoot, { recursive: true })
      await writeFile(
        this.activePath,
        `${JSON.stringify({ version: this.latestVersion }, null, 2)}\n`,
        'utf8'
      )
      this.updateState = 'idle'
    } catch (error) {
      this.updateState = 'error'
      this.updateError = error instanceof Error ? error.message : String(error)
    }
    return this.emitStatus()
  }

  async reportUpdateBlocked(blockingThreads: CopilotSdkUpdateBlocker[]): Promise<CopilotSdkStatus> {
    const titles = blockingThreads.map((thread) => `"${thread.title}"`).join(', ')
    this.updateState = 'error'
    this.updateError =
      blockingThreads.length === 1
        ? `Finish or stop the active Copilot agent in ${titles} before updating.`
        : `Finish or stop the active Copilot agents in these threads before updating: ${titles}.`
    this.blockingThreads = blockingThreads.map((thread) => ({ ...thread }))
    return this.emitStatus()
  }

  async loadSdk(): Promise<{
    module: CopilotSdkModule
    version: string
    runtimePath: string | null
  }> {
    const active = await this.readActiveSdk()
    if (!active) {
      return {
        module: { CopilotClient: BundledCopilotClient },
        version: BUNDLED_VERSION,
        runtimePath: this.getBundledRuntimePath()
      }
    }

    const moduleUrl = pathToFileURL(this.getManagedEntry(active.version)).href
    const loaded = (await import(moduleUrl)) as CopilotSdkModule
    return {
      module: loaded,
      version: active.version,
      runtimePath: this.getManagedRuntimePath(active.version)
    }
  }

  async setRuntimeStatus(input: {
    authenticated: boolean
    authLabel: string | null
    runtimeVersion: string | null
  }): Promise<void> {
    this.authenticated = input.authenticated
    this.authLabel = input.authLabel
    this.runtimeVersion = input.runtimeVersion
    await this.emitStatus()
  }

  private async emitStatus(): Promise<CopilotSdkStatus> {
    const status = await this.getStatus()
    this.onStatusChanged(status)
    return status
  }
}
