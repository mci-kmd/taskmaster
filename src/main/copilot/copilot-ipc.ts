import type {
  CopilotInteractionResponse,
  CopilotSendInput,
  CopilotSetModelInput
} from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { handleIpc } from '../ipc/typed-ipc'

type CopilotSessionService = ReturnType<
  typeof import('./copilot-session-service').createCopilotSessionService
>

export function registerCopilotIpc(service: CopilotSessionService): void {
  handleIpc(IPC_CHANNELS.copilot.getSdkStatus, () => service.getSdkStatus())
  handleIpc(IPC_CHANNELS.copilot.checkForSdkUpdate, () => service.checkForSdkUpdate())
  handleIpc(IPC_CHANNELS.copilot.updateSdk, () => service.updateSdk())
  handleIpc(IPC_CHANNELS.copilot.start, (_event, threadId: string) => service.start(threadId))
  handleIpc(IPC_CHANNELS.copilot.getSession, (_event, threadId: string) =>
    service.getSession(threadId)
  )
  handleIpc(IPC_CHANNELS.copilot.getPerformanceSamples, () => service.getPerformanceSamples())
  handleIpc(IPC_CHANNELS.copilot.listSkills, (_event, threadId: string) =>
    service.listSkills(threadId)
  )
  handleIpc(IPC_CHANNELS.copilot.send, (_event, input: CopilotSendInput) => service.send(input))
  handleIpc(IPC_CHANNELS.copilot.abort, (_event, threadId: string) => service.abort(threadId))
  handleIpc(IPC_CHANNELS.copilot.setModel, (_event, input: CopilotSetModelInput) =>
    service.setModel(input)
  )
  handleIpc(IPC_CHANNELS.copilot.respond, (_event, input: CopilotInteractionResponse) =>
    service.respond(input)
  )
  handleIpc(IPC_CHANNELS.copilot.pickAttachments, () => service.pickAttachments())
}
