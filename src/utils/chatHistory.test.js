import { describe, expect, it } from 'vitest'

import { MAX_TURNS, toHistory } from './chatHistory'

const welcome = { id: 'welcome', role: 'bot', text: 'Ask about planner records…' }

describe('toHistory', () => {
  it('maps the assistant role the API expects', () => {
    expect(toHistory([{ id: '1', role: 'bot', text: 'Hello' }]))
      .toEqual([{ role: 'assistant', text: 'Hello' }])
  })

  it('keeps user turns as they are', () => {
    expect(toHistory([{ id: '1', role: 'user', text: 'Hi' }]))
      .toEqual([{ role: 'user', text: 'Hi' }])
  })

  it('drops the opening blurb, which the student never said', () => {
    expect(toHistory([welcome, { id: '1', role: 'user', text: 'Hi' }]))
      .toEqual([{ role: 'user', text: 'Hi' }])
  })

  it('drops failed requests', () => {
    // An error is the app talking about itself, not a turn in the conversation.
    const history = toHistory([
      { id: '1', role: 'user', text: 'Hi' },
      { id: '2', role: 'error', text: 'Copilot request failed.' },
    ])
    expect(history).toEqual([{ role: 'user', text: 'Hi' }])
  })

  it('drops empty and whitespace-only turns', () => {
    expect(toHistory([{ id: '1', role: 'user', text: '   ' }])).toEqual([])
  })

  it('keeps the most recent turns when the conversation is long', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), role: 'user', text: `m${i}` }))
    const history = toHistory(many)
    expect(history).toHaveLength(MAX_TURNS)
    expect(history[history.length - 1].text).toBe('m29')
    expect(history[0].text).toBe('m10')
  })

  it('truncates a turn past the length the API accepts', () => {
    const long = { id: '1', role: 'user', text: 'x'.repeat(5000) }
    expect(toHistory([long])[0].text).toHaveLength(4000)
  })

  it('survives an empty or missing conversation', () => {
    expect(toHistory([])).toEqual([])
    expect(toHistory(undefined)).toEqual([])
  })

  it('preserves order, oldest first', () => {
    const history = toHistory([
      { id: '1', role: 'user', text: 'first' },
      { id: '2', role: 'bot', text: 'second' },
    ])
    expect(history.map(t => t.text)).toEqual(['first', 'second'])
  })
})
