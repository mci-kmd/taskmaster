// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

export function sanitizeUserFacingMessage(value: string): string {
  return (
    value
      .replace(ANSI_ESCAPE_PATTERN, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g, '')
  )
}
