import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type {
  IpcEventChannel,
  IpcEventDefinitions,
  IpcInvokeChannel,
  IpcInvokeDefinitions,
  IpcSendChannel,
  IpcSendDefinitions
} from '../../shared/contracts/ipc'

type MaybePromise<T> = T | Promise<T>

type IpcHandler<Channel extends IpcInvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...request: IpcInvokeDefinitions[Channel]['request']
) => MaybePromise<IpcInvokeDefinitions[Channel]['response']>

type IpcSendHandler<Channel extends IpcSendChannel> = (
  event: IpcMainEvent,
  payload: IpcSendDefinitions[Channel]['payload']
) => void

export function handleIpc<Channel extends IpcInvokeChannel>(
  channel: Channel,
  handler: IpcHandler<Channel>
): void {
  ipcMain.handle(channel, (event, ...request) =>
    handler(event, ...(request as IpcInvokeDefinitions[Channel]['request']))
  )
}

export function onIpc<Channel extends IpcSendChannel>(
  channel: Channel,
  handler: IpcSendHandler<Channel>
): void {
  ipcMain.on(channel, (event, payload) =>
    handler(event, payload as IpcSendDefinitions[Channel]['payload'])
  )
}

export function sendIpc<Channel extends IpcEventChannel>(
  target: WebContents,
  channel: Channel,
  payload: IpcEventDefinitions[Channel]['payload']
): void {
  target.send(channel, payload)
}
