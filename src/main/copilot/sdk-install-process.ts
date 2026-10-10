/**
 * Installs a Copilot SDK version in a utility process. npm's Arborist is CPU-heavy (loading it,
 * resolving the tree, extracting tarballs), and in the main process that work stalls the window,
 * so the main process forks this script instead (see copilot-sdk-manager.ts).
 */
import { createRequire } from 'module'

type InstallRequest = { targetDirectory: string; version: string }
type InstallResponse = { ok: true } | { ok: false; error: string }

type Arborist = new (options: { path: string; audit: boolean; fund: boolean }) => {
  reify: (options: { add: string[]; saveType: 'prod'; omit: string[] }) => Promise<unknown>
}

process.parentPort.once('message', async ({ data }: { data: InstallRequest }) => {
  let response: InstallResponse
  try {
    const require = createRequire(import.meta.url)
    const Arborist = require('@npmcli/arborist') as Arborist
    await new Arborist({ path: data.targetDirectory, audit: false, fund: false }).reify({
      add: [`@github/copilot-sdk@${data.version}`],
      saveType: 'prod',
      omit: ['dev']
    })
    response = { ok: true }
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  process.parentPort.postMessage(response)
})
