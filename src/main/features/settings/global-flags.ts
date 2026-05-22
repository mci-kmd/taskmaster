export function parseGlobalFlags(input: string): string[] {
  const tokens: string[] = []
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|[^\s]+/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[0]
    tokens.push(token.replace(/\\"/g, '"').replace(/\\'/g, "'"))
  }

  return tokens
}
