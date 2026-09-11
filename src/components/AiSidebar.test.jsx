import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AttachedRecordChip from './AttachedRecordChip'
import { AgentSteps, CitationList, ConversationList, FirstRunNotice, ProposalCard, ProposalList, ThinkingIndicator, seriesSummary } from './AiSidebar'

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

  it('says what the assistant can see, and lets it be taken off', () => {
    const detach = vi.fn()
    render(<AttachedRecordChip
      attachment={{ id: 'n1', kind: 'note', title: 'Chem notes', approvedForAi: true }}
      onDetach={detach}
    />)

    expect(screen.getByText('Chem notes')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /The assistant can read this record/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Remove Chem notes/ }))
    expect(detach).toHaveBeenCalled()
  })

  it('says plainly when a record kept out of the assistant is being shared', () => {
    // The student set that flag deliberately. Attaching it for one question is
    // defensible; doing it without saying so is not.
    render(<AttachedRecordChip
      attachment={{ id: 'n2', kind: 'note', title: 'Private', approvedForAi: false }}
      onDetach={vi.fn()}
    />)

    expect(screen.getByText('Shared for this question only')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: /kept out of the assistant/ })).toBeInTheDocument()
  })

  it('renders nothing when no record is attached', () => {
    const { container } = render(<AttachedRecordChip attachment={null} onDetach={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a note rewrite as a diff rather than two walls of text', () => {
    // The complaint this was built for: an edited note showed the whole old
    // body struck through beside the whole new one, and a student could not
    // tell what had actually changed.
    render(<ProposalCard proposal={{
      proposal_id: 'p9', operation: 'update', entity_type: 'note', status: 'pending',
      rationale: 'Change note: Chem notes',
      before: { entity_type: 'note', title: 'Chem notes', body: 'Rinse the burette, fill to zero.' },
      after: { entity_type: 'note', title: 'Chem notes', body: 'Rinse the burette twice, fill to zero.' },
    }} onConfirm={vi.fn()} onReject={vi.fn()} />)

    // The stat line is what has to work even when the diff is collapsed.
    expect(screen.getByText('1 word added')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Text: 1 word added/ })).toBeInTheDocument()
  })

  it('leaves a create alone, where there is nothing to diff against', () => {
    render(<ProposalCard proposal={{
      proposal_id: 'p10', operation: 'create', entity_type: 'note', status: 'pending',
      rationale: 'Add note: Fresh notes',
      before: null,
      after: { entity_type: 'note', title: 'Fresh notes', body: 'All new text' },
    }} onConfirm={vi.fn()} onReject={vi.fn()} />)

    expect(screen.queryByRole('group', { name: /Text/ })).not.toBeInTheDocument()
    expect(screen.getByText('Adds')).toBeInTheDocument()
  })

  it('shows before and after but does not confirm until clicked', () => {
    const confirm = vi.fn()
    render(<ProposalCard proposal={{
      proposal_id: 'p1', operation: 'complete', entity_type: 'task', status: 'pending',
      rationale: 'Requested by user',
      before: { title: 'Lab report', completed: false },
      after: { title: 'Lab report', completed: true },
    }} onConfirm={confirm} onReject={vi.fn()} />)
    // The change reads as what moves, not as the stored record.
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument()
    expect(screen.queryByText(/completed/)).not.toBeInTheDocument()
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
    expect(screen.getByText('Adds')).toBeInTheDocument()
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
    expect(screen.queryByText('Adds')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review each/ }))
    expect(screen.getAllByText('Adds')).toHaveLength(3)
  })
})

describe('a repeat', () => {
  const weekly = count => ({
    proposal_id: 'p1', operation: 'create', entity_type: 'reminder', status: 'pending',
    rationale: 'Every Friday at 1:30 PM.',
    before: null, after: { title: 'Fill Microsoft Form', date: '2026-09-04' },
    series: Array.from({ length: count }, (_, index) => ({
      record_id: `r${index}`,
      content: { title: 'Fill Microsoft Form', date: `2026-09-${String(4 + index * 7).padStart(2, '0')}` },
    })),
  })

  it('says how many records one confirmation will write', () => {
    // The preview shows the first occurrence, so without this the student is
    // confirming thirteen records having been shown one.
    render(<ProposalCard proposal={weekly(3)} onConfirm={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText(/Creates 3 records, 2026-09-04 to 2026-09-18/)).toBeInTheDocument()
  })

  it('stays quiet for an ordinary single change', () => {
    expect(seriesSummary(weekly(1))).toBeNull()
    expect(seriesSummary({ operation: 'create' })).toBeNull()
  })

  it('is one card, not one per occurrence', () => {
    render(<ProposalList proposals={[weekly(13)]} onConfirm={vi.fn()} onReject={vi.fn()}
      onConfirmAll={vi.fn()} onRejectAll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Confirm all/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm change/ })).toBeInTheDocument()
  })
})

describe('coming back to an earlier conversation', () => {
  const threads = [
    { conversation_id: 'c1', title: 'What is due today?', message_count: 4 },
    { conversation_id: 'c2', title: 'Push my overdue work', message_count: 2 },
  ]

  it('lists the threads there are to return to', () => {
    render(<ConversationList conversations={threads} currentId="c1" onOpen={vi.fn()}
      onRename={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('What is due today?')).toBeInTheDocument()
    expect(screen.getByText('Push my overdue work')).toBeInTheDocument()
  })

  it('opens the one that is picked', () => {
    const open = vi.fn()
    render(<ConversationList conversations={threads} currentId="c1" onOpen={open}
      onRename={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Push my overdue work'))
    expect(open).toHaveBeenCalledWith('c2')
  })

  it('deletes a single thread by name', () => {
    const remove = vi.fn()
    render(<ConversationList conversations={threads} currentId="c1" onOpen={vi.fn()}
      onRename={vi.fn()} onDelete={remove} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Delete "Push my overdue work"/ }))
    expect(remove).toHaveBeenCalledWith('c2')
  })

  it('says so when there is nothing to come back to yet', () => {
    render(<ConversationList conversations={[]} currentId={null} onOpen={vi.fn()}
      onRename={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument()
  })
})
