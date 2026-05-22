export type RendererApi = Window['api']

export function getRendererApi(): RendererApi {
  return window.api
}
