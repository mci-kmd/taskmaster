import type { AgentLaunchRequest } from '../../shared/app-types'

export function buildCopilotArgs(launch?: AgentLaunchRequest, rawArgs: string[] = []): string[] {
  if (!launch) {
    return rawArgs
  }

  const launchFlag =
    launch.mode === 'resume' && launch.resumeSessionId
      ? `--resume=${launch.resumeSessionId}`
      : `--name=${launch.sessionName}`
  return [launchFlag, ...launch.globalFlags]
}

export function buildCodexArgs(
  cwd: string,
  launch?: AgentLaunchRequest,
  rawArgs: string[] = []
): string[] {
  if (!launch) {
    return rawArgs
  }

  const sharedArgs = ['--cd', cwd, '--no-alt-screen', ...launch.globalFlags]
  if (launch.mode === 'resume' && launch.resumeSessionId) {
    return ['resume', ...sharedArgs, launch.resumeSessionId]
  }

  return sharedArgs
}
