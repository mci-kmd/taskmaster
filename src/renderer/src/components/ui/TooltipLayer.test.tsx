// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TooltipLayer from './TooltipLayer'
import { richTooltip } from '../../lib/tooltip'

const tooltip = (): Element | null => document.querySelector('.tm-tooltip')
/** Lets the layer's MutationObserver see DOM changes made by React. */
const flushMutations = (): Promise<void> => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('shows a themed tooltip for a title after the pointer rests on it', () => {
  render(
    <>
      <button title={'Settle thread\nKeeps its branch'}>✓</button>
      <TooltipLayer />
    </>
  )
  const button = screen.getByRole('button')
  // The native tooltip is suppressed; the text stays available to assistive technology.
  expect(button.getAttribute('title')).toBe('')
  expect(button.getAttribute('aria-description')).toBe('Settle thread\nKeeps its branch')

  fireEvent.pointerOver(button)
  expect(tooltip()).toBeNull()
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()?.textContent).toBe('Settle thread\nKeeps its branch')

  fireEvent.pointerOut(button, { relatedTarget: document.body })
  expect(tooltip()).toBeNull()
})

it('hides when the element is clicked and skips the delay for the next one', () => {
  render(
    <>
      <button title="First">1</button>
      <button title="Second">2</button>
      <TooltipLayer />
    </>
  )
  const [first, second] = screen.getAllByRole('button')

  fireEvent.pointerOver(first)
  act(() => vi.advanceTimersByTime(500))
  fireEvent.pointerDown(first)
  expect(tooltip()).toBeNull()

  fireEvent.pointerOver(second)
  expect(tooltip()?.textContent).toBe('Second')
})

it('follows title changes and removals made by the app', async () => {
  const view = (title?: string): React.JSX.Element => (
    <>
      <button title={title}>Run</button>
      <TooltipLayer />
    </>
  )
  const { rerender } = render(view('Run project command'))
  const button = screen.getByRole('button')
  fireEvent.pointerOver(button)
  act(() => vi.advanceTimersByTime(500))

  rerender(view('Stop run command'))
  await flushMutations()
  expect(button.getAttribute('title')).toBe('')
  expect(tooltip()?.textContent).toBe('Stop run command')
  expect(button.getAttribute('aria-description')).toBe('Stop run command')

  rerender(view(undefined))
  await flushMutations()
  expect(tooltip()).toBeNull()
  expect(button.hasAttribute('data-tooltip')).toBe(false)
  expect(button.hasAttribute('aria-description')).toBe(false)
})

it("keeps a nested element from showing its ancestor's native tooltip", () => {
  render(
    <>
      <button title="Thread">
        <span title="App running">▶</span>
      </button>
      <TooltipLayer />
    </>
  )
  // An empty title stops the ancestor's title from applying to the icon.
  expect(screen.getByText('▶').getAttribute('title')).toBe('')
  fireEvent.pointerOver(screen.getByText('▶'))
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()?.textContent).toBe('App running')
})

it('hides a tooltip whose element is removed', async () => {
  const view = (shown: boolean): React.JSX.Element => (
    <>
      {shown ? <button title="Close thread">×</button> : null}
      <TooltipLayer />
    </>
  )
  const { rerender } = render(view(true))
  fireEvent.pointerOver(screen.getByRole('button'))
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()).not.toBeNull()

  rerender(view(false))
  await flushMutations()
  expect(tooltip()).toBeNull()
})

it('shows structured tooltips in the opposite appearance from the app', () => {
  render(
    <>
      <button ref={richTooltip(<strong>Refresh the app</strong>, 'right')}>Thread</button>
      <TooltipLayer />
    </>
  )
  fireEvent.pointerOver(screen.getByRole('button'))
  act(() => vi.advanceTimersByTime(500))

  const shown = tooltip() as HTMLElement
  expect(shown.querySelector('strong')?.textContent).toBe('Refresh the app')
  expect(shown.dataset.rich).toBe('true')
  // The app defaults to a dark theme, so tooltips use the light one.
  expect(shown.dataset.theme).toBe('porcelain')
})

it('updates a shown structured tooltip when its content changes', () => {
  const view = (status: string): React.JSX.Element => (
    <>
      <button ref={richTooltip(<span>{status}</span>, 'right')}>Thread</button>
      <TooltipLayer />
    </>
  )
  const { rerender } = render(view('Working'))
  fireEvent.pointerOver(screen.getByRole('button'))
  act(() => vi.advanceTimersByTime(500))
  expect(tooltip()?.textContent).toBe('Working')

  rerender(view('Done'))
  expect(tooltip()?.textContent).toBe('Done')
})
