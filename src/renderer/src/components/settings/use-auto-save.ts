import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export type AutoSaveResult = { ok: boolean; error?: string }

export type AutoSaveFieldStatus =
  { state: 'idle' | 'saving' | 'saved'; error?: undefined } | { state: 'error'; error: string }

/** A single auto-saved value, ready to bind to a settings control. */
export type AutoSaveField<V> = {
  /** Stable DOM id for the field's control. */
  id: string
  value: V
  status: AutoSaveFieldStatus
  /** Update the value and save it right away (toggles, pickers, file browsers). */
  set: (value: V) => void
  /** Update the value and save it after a short pause in typing. */
  edit: (value: V) => void
  /** Save a pending edit now (blur, Enter). */
  commit: () => void
}

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type AutoSave<T extends object> = {
  values: T
  field: <K extends keyof T & string>(key: K) => AutoSaveField<T[K]>
  /** Saves every pending edit; resolves once all queued saves have finished. */
  flush: () => Promise<void>
  status: AutoSaveStatus
  errorCount: number
  hasErrors: (keys: readonly (keyof T)[]) => boolean
}

export const AUTO_SAVE_DELAY_MS = 500
const SAVED_FLASH_MS = 2000
const IDLE: AutoSaveFieldStatus = { state: 'idle' }

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Keeps draft values for a settings form and persists each changed field on its own.
 *
 * Saves run one at a time. Each sends the last successfully saved values with only the
 * changed field replaced, so a value rejected by validation never blocks other fields and
 * the last valid value stays persisted. Pending edits are flushed on unmount.
 */
export function useAutoSave<T extends object>({
  initialValues,
  save,
  delayMs = AUTO_SAVE_DELAY_MS
}: {
  initialValues: T
  save: (values: T, changedKey: keyof T) => Promise<AutoSaveResult>
  delayMs?: number
}): AutoSave<T> {
  const idPrefix = useId()
  const [values, setValues] = useState(initialValues)
  const [statuses, setStatuses] = useState<Partial<Record<keyof T, AutoSaveFieldStatus>>>({})
  const [savingCount, setSavingCount] = useState(0)
  const [hasSaved, setHasSaved] = useState(false)
  const draftsRef = useRef(initialValues)
  const savedRef = useRef(initialValues)
  const saveRef = useRef(save)
  const timersRef = useRef(new Map<keyof T, ReturnType<typeof setTimeout>>())
  const flashTimersRef = useRef(new Map<keyof T, ReturnType<typeof setTimeout>>())
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useLayoutEffect(() => {
    saveRef.current = save
  })

  const setStatus = useCallback((key: keyof T, status: AutoSaveFieldStatus): void => {
    setStatuses((current) => ({ ...current, [key]: status }))
  }, [])

  const commit = useCallback(
    (key: keyof T): Promise<void> => {
      const timer = timersRef.current.get(key)
      if (timer !== undefined) {
        clearTimeout(timer)
        timersRef.current.delete(key)
      }

      const run = async (): Promise<void> => {
        const value = draftsRef.current[key]
        if (sameValue(value, savedRef.current[key])) {
          // Reverting to the saved value resolves any error shown for a rejected edit.
          setStatuses((current) =>
            current[key]?.state === 'error' ? { ...current, [key]: IDLE } : current
          )
          return
        }

        const flash = flashTimersRef.current.get(key)
        if (flash !== undefined) {
          clearTimeout(flash)
          flashTimersRef.current.delete(key)
        }
        setStatus(key, { state: 'saving' })
        setSavingCount((count) => count + 1)
        let result: AutoSaveResult
        try {
          result = await saveRef.current({ ...savedRef.current, [key]: value } as T, key)
        } catch (cause) {
          result = { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
        }
        setSavingCount((count) => count - 1)

        if (result.ok) {
          savedRef.current = { ...savedRef.current, [key]: value } as T
          setHasSaved(true)
          setStatus(key, { state: 'saved' })
          flashTimersRef.current.set(
            key,
            setTimeout(() => {
              flashTimersRef.current.delete(key)
              setStatuses((current) =>
                current[key]?.state === 'saved' ? { ...current, [key]: IDLE } : current
              )
            }, SAVED_FLASH_MS)
          )
        } else {
          setStatus(key, { state: 'error', error: result.error ?? 'Could not save this setting.' })
        }
      }

      queueRef.current = queueRef.current.then(run)
      return queueRef.current
    },
    [setStatus]
  )

  const update = useCallback(
    (key: keyof T, value: unknown, debounce: boolean): void => {
      draftsRef.current = { ...draftsRef.current, [key]: value } as T
      setValues(draftsRef.current)
      if (!debounce) {
        void commit(key)
        return
      }
      const timer = timersRef.current.get(key)
      if (timer !== undefined) clearTimeout(timer)
      timersRef.current.set(
        key,
        setTimeout(() => void commit(key), delayMs)
      )
    },
    [commit, delayMs]
  )

  const flush = useCallback((): Promise<void> => {
    for (const key of [...timersRef.current.keys()]) {
      void commit(key)
    }
    return queueRef.current
  }, [commit])

  useEffect(() => {
    const flashTimers = flashTimersRef.current
    return () => {
      void flush()
      for (const timer of flashTimers.values()) clearTimeout(timer)
      flashTimers.clear()
    }
  }, [flush])

  const errorCount = Object.values<AutoSaveFieldStatus | undefined>(statuses).filter(
    (status) => status?.state === 'error'
  ).length

  return {
    values,
    field: <K extends keyof T & string>(key: K): AutoSaveField<T[K]> => ({
      id: `${idPrefix}-${key}`,
      value: values[key],
      status: statuses[key] ?? IDLE,
      set: (value) => update(key, value, false),
      edit: (value) => update(key, value, true),
      commit: () => void commit(key)
    }),
    flush,
    status: savingCount > 0 ? 'saving' : errorCount > 0 ? 'error' : hasSaved ? 'saved' : 'idle',
    errorCount,
    hasErrors: (keys) => keys.some((key) => statuses[key]?.state === 'error')
  }
}
