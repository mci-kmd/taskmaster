import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MOTION, canAnimate } from './motion'

export type PresenceEntry<T> = {
  key: string
  item: T
  /** Set while the entry is animating out after leaving the list. */
  exitToken: number | null
}

type PresenceState<T> = {
  items: readonly T[]
  resetKey: string
  entries: PresenceEntry<T>[]
}

const ENTER_MS = MOTION.baseMs
const MOVE_MS = MOTION.slowMs
const EXIT_MS = MOTION.exitMs

let nextExitToken = 1

function toEntries<T>(items: readonly T[], getKey: (item: T) => string): PresenceEntry<T>[] {
  return items.map((item) => ({ key: getKey(item), item, exitToken: null }))
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/** Keeps removed entries next to their former neighbour so they can animate out in place. */
export function mergePresenceEntries<T>(
  previous: readonly PresenceEntry<T>[],
  items: readonly T[],
  getKey: (item: T) => string
): PresenceEntry<T>[] {
  const nextKeys = new Set(items.map(getKey))
  const leading: PresenceEntry<T>[] = []
  const trailing = new Map<string, PresenceEntry<T>[]>()
  let anchor: string | null = null
  for (const entry of previous) {
    if (nextKeys.has(entry.key)) {
      anchor = entry.key
      continue
    }
    const exiting = entry.exitToken === null ? { ...entry, exitToken: nextExitToken++ } : entry
    if (anchor === null) {
      leading.push(exiting)
    } else {
      trailing.set(anchor, [...(trailing.get(anchor) ?? []), exiting])
    }
  }

  const merged = [...leading]
  for (const item of items) {
    const key = getKey(item)
    merged.push({ key, item, exitToken: null }, ...(trailing.get(key) ?? []))
  }
  return merged
}

/**
 * Returns list entries that include recently removed items until their exit animation ends.
 * Changing `resetKey` swaps the list without exit animations.
 */
export function usePresenceList<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  resetKey: string
): PresenceEntry<T>[] {
  const [state, setState] = useState<PresenceState<T>>(() => ({
    items,
    resetKey,
    entries: toEntries(items, getKey)
  }))

  let current = state
  if (state.resetKey !== resetKey || !sameItems(state.items, items)) {
    current = {
      items,
      resetKey,
      entries:
        state.resetKey === resetKey && canAnimate()
          ? mergePresenceEntries(state.entries, items, getKey)
          : toEntries(items, getKey)
    }
    setState(current)
  }

  const { entries } = current
  useEffect(() => {
    const tokens = new Set(entries.flatMap((entry) => entry.exitToken ?? []))
    if (tokens.size === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setState((latest) => ({
        ...latest,
        entries: latest.entries.filter(
          (entry) => entry.exitToken === null || !tokens.has(entry.exitToken)
        )
      }))
    }, EXIT_MS + 40)
    return () => window.clearTimeout(timer)
  }, [entries])

  return entries
}

/**
 * Animates entering, moving, and exiting children marked with `data-motion-key`.
 * Exiting children must also carry `data-exiting`.
 */
export function useAnimatedListMotion<E extends HTMLElement>(
  resetKey: string
): React.RefObject<E | null> {
  const list = useRef<E>(null)
  const previous = useRef({ resetKey, order: '', tops: new Map<string, number>() })
  const exiting = useRef(new Set<string>())

  useLayoutEffect(() => {
    const children = Array.from(list.current?.children ?? []).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.motionKey
    )
    const animate = canAnimate()
    const reset = previous.current.resetKey !== resetKey
    const oldTops = reset ? new Map<string, number>() : previous.current.tops
    const order = children
      .filter((child) => child.dataset.exiting === undefined)
      .map((child) => child.dataset.motionKey)
      .join('\n')
    const orderChanged = reset || order !== previous.current.order
    const tops = new Map<string, number>()

    for (const child of children) {
      const key = child.dataset.motionKey as string
      if (child.dataset.exiting !== undefined) {
        if (animate && !exiting.current.has(key)) {
          exiting.current.add(key)
          const style = getComputedStyle(child)
          child.getAnimations().forEach((animation) => animation.cancel())
          child.style.overflow = 'hidden'
          child.animate(
            [
              {
                opacity: 1,
                height: `${child.offsetHeight}px`,
                paddingBottom: style.paddingBottom,
                transform: 'scale(1)'
              },
              { opacity: 0, height: '0px', paddingBottom: '0px', transform: 'scale(0.98)' }
            ],
            { duration: EXIT_MS, easing: MOTION.easeIn, fill: 'forwards' }
          )
        }
        continue
      }

      if (exiting.current.delete(key)) {
        child.getAnimations().forEach((animation) => animation.cancel())
        child.style.overflow = ''
      }
      const top = child.offsetTop
      tops.set(key, top)
      if (!animate || !orderChanged) {
        continue
      }

      const oldTop = oldTops.get(key)
      if (oldTop === undefined) {
        child.getAnimations().forEach((animation) => animation.cancel())
        child.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: ENTER_MS, easing: MOTION.easeOut }
        )
      } else if (oldTop !== top) {
        child.getAnimations().forEach((animation) => animation.cancel())
        child.animate(
          [{ transform: `translateY(${oldTop - top}px)` }, { transform: 'translateY(0)' }],
          { duration: MOVE_MS, easing: MOTION.easeOut }
        )
      }
    }

    for (const key of exiting.current) {
      if (!children.some((child) => child.dataset.motionKey === key)) {
        exiting.current.delete(key)
      }
    }
    previous.current = { resetKey, order, tops }
  })

  return list
}
