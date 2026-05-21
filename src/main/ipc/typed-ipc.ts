import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcInvokeChannel, IpcInvokeDefinitions } from '../../shared/contracts/ipc'

type MaybePromise<T> = T | Promise<T>

type IpcHandler<Channel extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...request: IpcInvokeDefinitions[Channel]['request']
) => MaybePromise<IpcInvokeDefinitions[Channel]['response']>

export function handleIpc<Channel extends IpcInvokeChannel>(
  channel: Channel,
  handler: IpcHandler<Channel>
): void {
  ipcMain.handle(channel, (event, ...request) =>
    handler(event, ...(request as IpcInvokeDefinitions[Channel]['request']))
  )
}
