import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SubmitButton, { SubmitError, useSubmit } from './SubmitButton'

function Form({ onSave }) {
  const { submit, busy, error } = useSubmit(onSave)
  return (
    <form onSubmit={e => { e.preventDefault(); submit({ title: 'x' }) }}>
      <SubmitError message={error} />
      <SubmitButton busy={busy}>Add Task</SubmitButton>
    </form>
  )
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('saving from a modal', () => {
  it('saves once however fast the button is clicked', async () => {
    const pending = deferred()
    const onSave = vi.fn(() => pending.promise)
    render(<Form onSave={onSave} />)
    const button = screen.getByRole('button', { name: 'Add Task' })
    // Three clicks inside one frame, before React re-renders the disabled button.
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => pending.resolve())
    expect(button).not.toBeDisabled()
  })

  it('shows no spinner for a save that finishes quickly', async () => {
    vi.useFakeTimers()
    render(<Form onSave={() => Promise.resolve()} />)
    fireEvent.click(screen.getByRole('button'))
    await act(async () => {})
    await act(async () => vi.advanceTimersByTime(500))
    expect(screen.getByRole('button')).not.toHaveClass('is-busy')
  })

  it('shows the spinner and grays out once a save runs long', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    const { container } = render(<Form onSave={() => pending.promise} />)
    fireEvent.click(screen.getByRole('button'))
    await act(async () => vi.advanceTimersByTime(100))
    expect(container.querySelector('.btn-spinner')).toBeNull()
    await act(async () => vi.advanceTimersByTime(150))
    expect(container.querySelector('.btn-spinner')).not.toBeNull()
    expect(screen.getByRole('button')).toHaveClass('is-busy')
    await act(async () => pending.resolve())
    expect(container.querySelector('.btn-spinner')).toBeNull()
  })

  it('tells the user why a save failed and lets them retry', async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error('You are offline.'))
      .mockResolvedValueOnce()
    render(<Form onSave={onSave} />)
    await act(async () => fireEvent.click(screen.getByRole('button')))
    expect(screen.getByRole('alert')).toHaveTextContent('You are offline.')
    await act(async () => fireEvent.click(screen.getByRole('button')))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
