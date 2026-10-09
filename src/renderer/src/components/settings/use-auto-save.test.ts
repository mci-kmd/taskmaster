// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAutoSave, type AutoSave, type AutoSaveResult } from './use-auto-save'

type Values = { name: string; enabled: boolean }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function setup(
  save: (values: Values) => Promise<AutoSaveResult>
): ReturnType<typeof renderHook<AutoSave<Values>, unknown>> {
  return renderHook(() =>
    useAutoSave<Values>({ initialValues: { name: 'a', enabled: false }, save })
  )
}

it('debounces edits and saves only the latest value', async () => {
  const save = vi.fn(async () => ({ ok: true }))
  const { result } = setup(save)

  act(() => result.current.field('name').edit('ab'))
  await act(() => vi.advanceTimersByTimeAsync(300))
  act(() => result.current.field('name').edit('abc'))
  await act(() => vi.advanceTimersByTimeAsync(499))
  expect(save).not.toHaveBeenCalled()
  await act(() => vi.advanceTimersByTimeAsync(1))

  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith({ name: 'abc', enabled: false }, 'name')
  expect(result.current.field('name').status.state).toBe('saved')
  expect(result.current.status).toBe('saved')

  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(result.current.field('name').status.state).toBe('idle')
})

it('runs saves one at a time so concurrent changes never revert each other', async () => {
  const pending: Array<() => void> = []
  const save = vi.fn(
    () => new Promise<AutoSaveResult>((resolve) => pending.push(() => resolve({ ok: true })))
  )
  const { result } = setup(save)

  act(() => {
    result.current.field('name').set('b')
    result.current.field('enabled').set(true)
  })
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.status).toBe('saving')

  await act(async () => pending.shift()?.())
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith({ name: 'b', enabled: true }, 'enabled')
  await act(async () => pending.shift()?.())
  expect(result.current.status).toBe('saved')
})

it('keeps the last valid value after a rejected save and skips unchanged values', async () => {
  const save = vi.fn(async (values: Values) =>
    values.name === 'bad' ? { ok: false, error: 'Bad name.' } : { ok: true }
  )
  const { result } = setup(save)

  act(() => result.current.field('name').set('bad'))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(result.current.field('name').status).toEqual({ state: 'error', error: 'Bad name.' })
  expect(result.current.errorCount).toBe(1)
  expect(result.current.hasErrors(['name'])).toBe(true)

  act(() => result.current.field('enabled').set(true))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(save).toHaveBeenLastCalledWith({ name: 'a', enabled: true }, 'enabled')

  // Reverting to the saved value clears the error without saving.
  act(() => result.current.field('name').set('a'))
  await act(() => vi.advanceTimersByTimeAsync(0))
  expect(save).toHaveBeenCalledTimes(2)
  expect(result.current.field('name').status.state).toBe('idle')
  expect(result.current.errorCount).toBe(0)
})

it('reports a thrown save as a field error', async () => {
  const { result } = setup(async () => {
    throw new Error('IPC failed')
  })

  act(() => result.current.field('enabled').set(true))
  await act(() => vi.advanceTimersByTimeAsync(0))

  expect(result.current.field('enabled').status).toEqual({ state: 'error', error: 'IPC failed' })
  expect(result.current.status).toBe('error')
})

it('flushes pending edits on unmount', async () => {
  const save = vi.fn(async () => ({ ok: true }))
  const { result, unmount } = setup(save)

  act(() => result.current.field('name').edit('typed'))
  unmount()
  await vi.advanceTimersByTimeAsync(0)

  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith({ name: 'typed', enabled: false }, 'name')
})
