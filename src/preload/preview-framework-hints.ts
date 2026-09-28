/**
 * Runs in the previewed page's main world (framework internals are invisible to the isolated
 * preload world), so it must be self-contained: it is serialized with `Function.prototype.toString`.
 * Returns component names innermost first, plus a source file when a dev build exposes one.
 */
export function collectFrameworkHints(attribute: string): {
  components: string[]
  sourceFile: string | null
} {
  const element = document.querySelector(`[${attribute}]`) as
    (Element & Record<string, unknown>) | null
  const components: string[] = []
  let sourceFile: string | null = null
  if (!element) return { components, sourceFile }
  const push = (name: unknown): void => {
    if (
      typeof name === 'string' &&
      /^[A-Z][\w$]+$/.test(name) &&
      !components.includes(name) &&
      components.length < 6
    )
      components.push(name)
  }
  type Node = Record<string, unknown> | null | undefined
  const read = (value: unknown, key: string): Node =>
    value && (typeof value === 'object' || typeof value === 'function')
      ? ((value as Record<string, unknown>)[key] as Node)
      : undefined
  try {
    const key = Object.keys(element).find(
      (name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')
    )
    let fiber = key ? (element[key] as Node) : null
    for (let depth = 0; fiber && depth < 200 && components.length < 6; depth++) {
      const type = fiber.type as Node
      if (typeof type === 'function') push(read(type, 'displayName') ?? read(type, 'name'))
      else if (type && typeof type === 'object') {
        const inner = read(type, 'render') ?? read(type, 'type')
        push(read(type, 'displayName') ?? read(inner, 'displayName') ?? read(inner, 'name'))
      }
      const source = fiber._debugSource as Node
      if (!sourceFile && typeof source?.fileName === 'string')
        sourceFile = `${source.fileName}${typeof source.lineNumber === 'number' ? `:${source.lineNumber}` : ''}`
      fiber = fiber.return as Node
    }
  } catch {
    // Framework internals vary between versions; hints are best effort.
  }
  try {
    let node: Element | null = element
    while (node && !(node as unknown as Record<string, unknown>).__vueParentComponent)
      node = node.parentElement
    let instance = node
      ? ((node as unknown as Record<string, unknown>).__vueParentComponent as Node)
      : null
    for (let depth = 0; instance && depth < 50 && components.length < 6; depth++) {
      const type = instance.type as Node
      const file = typeof type?.__file === 'string' ? type.__file : null
      push(
        read(type, 'name') ??
          read(type, '__name') ??
          file
            ?.split(/[\\/]/)
            .pop()
            ?.replace(/\.vue$/, '')
      )
      if (!sourceFile && file) sourceFile = file
      instance = instance.parent as Node
    }
  } catch {
    // Best effort.
  }
  try {
    let node: Element | null = element
    while (node && !(node as unknown as Record<string, unknown>).__svelte_meta)
      node = node.parentElement
    const meta = node ? ((node as unknown as Record<string, unknown>).__svelte_meta as Node) : null
    const file = read(meta?.loc, 'file')
    if (!sourceFile && typeof file === 'string') sourceFile = file
  } catch {
    // Best effort.
  }
  try {
    const ng = (window as unknown as Record<string, unknown>).ng as
      Record<string, (target: unknown) => unknown> | undefined
    if (ng && typeof ng.getOwningComponent === 'function') {
      let component = ng.getComponent?.(element) ?? ng.getOwningComponent(element)
      for (let depth = 0; component && depth < 6; depth++) {
        push(read(read(component, 'constructor'), 'name'))
        const host = ng.getHostElement?.(component) as Element | undefined
        component = host?.parentElement ? ng.getOwningComponent(host.parentElement) : null
      }
    }
  } catch {
    // Best effort.
  }
  return {
    components,
    sourceFile: sourceFile && sourceFile.length <= 300 ? sourceFile : null
  }
}
