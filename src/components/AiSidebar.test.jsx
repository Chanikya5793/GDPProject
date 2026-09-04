import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentSteps, CitationList, FirstRunNotice, ProposalCard, ProposalList, ThinkingIndicator } from './AiSidebar'

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

  it('names each lookup the assistant ran, in order', () => {
    // A multi-step answer is a long pause otherwise, and the student cannot
    // tell a thorough assistant from a stuck one.
    render(<AgentSteps steps={[
      { tool: 'find', label: 'Looked through open tasks (3 found)' },
      { tool: 'workload', label: 'Checked the workload rules (1 finding(s))' },
    ]} />)
    const shown = screen.getAllByRole('listitem').map(node => node.textContent)
    expect(shown).toEqual([
      'Looked through open tasks (3 found)',
      'Checked the workload rules (1 finding(s))',
    ])
  })

  it('shows nothing when the assistant answered without looking anything up', () => {
    const { container } = render(<AgentSteps steps={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('supports explicit cancellation while retrieval is active', () => {
    const cancel = vi.fn()
    render(<ThinkingIndicator onCancel={cancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})

describe('first-run disclosure', () => {
  const info = { provider: 'Meta', model: 'muse-spark-1.2-contributor', trains_on_prompts: true }

  it('names the provider and model that will see planner records', () => {
    render(<FirstRunNotice info={info} onAcknowledge={() => {}} />)
    expect(screen.getByText(/Meta/)).toBeInTheDocument()
    expect(screen.getByText(/muse-spark-1.2-contributor/)).toBeInTheDocument()
  })

  it('states plainly when the tier trains on what is sent', () => {
    // The assistant is on by default, so this may be the only place a student
    // is told. It must not be softened away.
    render(<FirstRunNotice info={info} onAcknowledge={() => {}} />)
    expect(screen.getByText(/used to train its models/)).toBeInTheDocument()
  })

  it('omits the training line when the tier does not train', () => {
    render(<FirstRunNotice info={{ ...info, trains_on_prompts: false }} onAcknowledge={() => {}} />)
    expect(screen.queryByText(/used to train its models/)).not.toBeInTheDocument()
  })

  it('still explains what happens when the provider is unknown', () => {
    // A failed /v1/ai-info must not turn the disclosure into silence.
    render(<FirstRunNotice info={null} onAcknowledge={() => {}} />)
    expect(screen.getByText(/configured AI provider/)).toBeInTheDocument()
  })

  it('points at both ways out', () => {
    render(<FirstRunNotice info={info} onAcknowledge={() => {}} />)
    expect(screen.getByText(/turn the assistant off entirely in Settings/)).toBeInTheDocument()
    expect(screen.getByText(/visibility switch/)).toBeInTheDocument()
  })

  it('acknowledges only when the button is pressed', () => {
    const seen = vi.fn()
    render(<FirstRunNotice info={info} onAcknowledge={seen} />)
    expect(seen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }))
    expect(seen).toHaveBeenCalled()
  })
})

describe('a batch of changes', () => {
  const many = count => Array.from({ length: count }, (_, index) => ({
    proposal_id: `p${index}`, operation: 'create', entity_type: 'task',
    status: 'pending', rationale: 'Weekly review',
    before: null, after: { title: `Weekly review ${index}` },
  }))

  it('asks for one decision instead of one per change', () => {
    // Thirteen weekly tasks used to mean thirteen Confirm buttons.
    const confirmAll = vi.fn()
    render(<ProposalList proposals={many(13)} onConfirm={vi.fn()} onReject={vi.fn()}
      onConfirmAll={confirmAll} onRejectAll={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Confirm all 13/ }))
    expect(confirmAll).toHaveBeenCalledTimes(1)
    expect(confirmAll.mock.calls[0][0]).toHaveLength(13)
  })

  it('still shows a single change as its own card, not a batch', () => {
    render(<ProposalList proposals={many(1)} onConfirm={vi.fn()} onReject={vi.fn()}
      onConfirmAll={vi.fn()} onRejectAll={vi.fn()} />)
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm all/ })).not.toBeInTheDocument()
  })

  it('counts only what is still pending', () => {
    const proposals = [...many(2), { ...many(1)[0], proposal_id: 'done', status: 'confirmed' }]
    render(<ProposalList proposals={proposals} onConfirm={vi.fn()} onReject={vi.fn()}
      onConfirmAll={vi.fn()} onRejectAll={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Confirm all 2/ })).toBeInTheDocument()
    expect(screen.getByText(/1 already decided/)).toBeInTheDocument()
  })

  it('opens up so each change can still be checked one by one', () => {
    render(<ProposalList proposals={many(3)} onConfirm={vi.fn()} onReject={vi.fn()}
      onConfirmAll={vi.fn()} onRejectAll={vi.fn()} />)
    expect(screen.queryByText('Before')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review each/ }))
    expect(screen.getAllByText('Before')).toHaveLength(3)
  })
})
