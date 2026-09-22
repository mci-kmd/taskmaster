// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Select from './Select'

const options = [
  { value: 'alpha', label: 'Alpha', description: '/projects/alpha' },
  { value: 'blocked', label: 'Unavailable', disabled: true },
  { value: 'beta', label: 'Beta', description: '/projects/beta' }
]
afterEach(cleanup)

describe('custom Select', () => {
  it('navigates by keyboard, skips disabled choices, and restores focus after selection', () => {
    const onChange = vi.fn()
    render(<Select aria-label="Project" options={options} value="alpha" onChange={onChange} />)
    const trigger = screen.getByRole('combobox')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Beta' }).id
    )
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('beta')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports typeahead, Escape without dismissing a parent, and outside click', () => {
    const onKeyDown = vi.fn()
    render(
      <div onKeyDown={onKeyDown}>
        <Select aria-label="Project" options={options} value="alpha" onChange={vi.fn()} />
      </div>
    )
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'b' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Beta' }).id
    )
    onKeyDown.mockClear()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('allows freeform branch names and selection from filtered suggestions', () => {
    function Branch(): React.JSX.Element {
      const [value, setValue] = useState('')
      return (
        <Select editable aria-label="Branch" options={options} value={value} onChange={setValue} />
      )
    }
    render(<Branch />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'beta' } })
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(input.value).toBe('beta')
    fireEvent.change(input, { target: { value: 'feature/new-branch' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('feature/new-branch')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('supports multiple choices and native required-form validation', () => {
    const submit = vi.fn()
    function Form(): React.JSX.Element {
      const [value, setValue] = useState<string[]>([])
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit(value)
          }}
        >
          <Select
            aria-label="Choices"
            multiple
            required
            options={options}
            value={value}
            onChange={setValue}
          />
          <button type="submit">Continue</button>
        </form>
      )
    }
    render(<Form />)
    const form = screen.getByRole('button', { name: 'Continue' }).closest('form')!
    act(() => {
      expect(form.checkValidity()).toBe(false)
    })
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }))
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true')
    expect(form.checkValidity()).toBe(true)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(submit).toHaveBeenCalledWith(['alpha', 'beta'])
  })

  it('keeps unavailable selections visible and respects disabled state', () => {
    render(
      <Select aria-label="Model" disabled value="legacy-model" options={[]} onChange={vi.fn()} />
    )
    const trigger = screen.getByRole('combobox') as HTMLButtonElement
    expect(trigger.textContent).toBe('legacy-model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
