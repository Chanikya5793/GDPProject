import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CitationList, ProposalCard, ThinkingIndicator } from './AiSidebar'

describe('copilot evidence and confirmation UI', () => {
  it('renders source-linked exact record metadata', () => {
    render(<CitationList citations={[{
      citation_id: 'S1', entity_type: 'task', record_id: 'task-1',
      revision: 4, title: 'Lab report', excerpt: 'Due Friday',
    }]} />)
    expect(screen.getByRole('link', { name: /Lab report · rev 4/ })).toHaveAttribute(
      'href', expect.stringContaining('focus=task-1'),
    )
  })

  it('shows before and after but does not confirm until clicked', () => {
    const confirm = vi.fn()
    render(<ProposalCard proposal={{
      proposal_id: 'p1', operation: 'complete', entity_type: 'task', status: 'pending',
      rationale: 'Requested by user', before: { completed: false }, after: { completed: true },
    }} onConfirm={confirm} onReject={vi.fn()} />)
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Confirm change/ }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('supports explicit cancellation while retrieval is active', () => {
    const cancel = vi.fn()
    render(<ThinkingIndicator onCancel={cancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

