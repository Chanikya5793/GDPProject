import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot, Send, Trash2, PanelRightClose, ExternalLink, Square, ShieldCheck, X, Search, ChevronDown, ChevronRight, Repeat, Plus, MessageSquare, Pencil } from 'lucide-react'
import { useAi } from '../context/AiContext'
import { changeLines, changeSummary } from '../utils/changePreview'
import '../css/AiSidebar.css'

const SUGGESTIONS = [
  'What is due today?',
  'What am I behind on?',
  'Summarize my week ahead',
  'Move my overdue work to Friday',
]

export function ThinkingIndicator({ onCancel }) {
  return (
    <div className="ai-msg ai-msg-bot">
      <div className="ai-msg-avatar"><Bot size={14} /></div>
      <div className="ai-msg-bubble ai-thinking">
        <span>Reading your planner…</span>
        <button onClick={onCancel}><Square size={11} /> Stop</button>
      </div>
    </div>
  )
}

export function FirstRunNotice({ info, onAcknowledge }) {
  // Named plainly rather than hedged: the assistant is on by default, so this is
  // the first and possibly only place a student learns where their planner text
  // goes. The provider comes from the server, so it cannot drift from what is
  // actually deployed; if it is unavailable the notice still states the shape of
  // what happens rather than silently saying nothing.
  return (
    <section className="ai-first-run" aria-label="How the assistant uses your planner">
      <div className="ai-first-run-title">
        <ShieldCheck size={14} />
        <strong>Before you start</strong>
      </div>
      <p>
        The assistant reads the planner records you have not excluded, and sends
        them {info ? <>to <strong>{info.provider}</strong> ({info.model})</> : 'to the configured AI provider'} to
        answer you.
      </p>
      {info?.trains_on_prompts && (
        <p className="ai-first-run-warn">
          That provider tier permits your questions and the record text sent with
          them to be used to train its models.
        </p>
      )}
      <p>
        Your conversations are kept, encrypted, so you can reopen one later or
        pick it up on another device. Turn that off in Settings and they stay on
        this device only.
      </p>
      <p>
        You can turn the assistant off entirely in Settings, or keep an individual
        task, reminder or note out of it with its own visibility switch.
      </p>
      <button onClick={onAcknowledge}>Got it</button>
    </section>
  )
}

export function AgentSteps({ steps }) {
  // What the assistant went and looked at, in the order it did it. A multi-step
  // answer otherwise reads as a long unexplained pause, and the student has no
  // way to tell a thorough answer from a stuck one.
  if (!steps?.length) return null
  return (
    <ol className="ai-steps" aria-label="What the assistant looked at">
      {steps.map((step, index) => (
        <li key={`${step.tool}-${index}`}>
          <Search size={11} aria-hidden="true" />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}

export function CitationList({ citations }) {
  if (!citations?.length) return null
  return (
    <div className="ai-citations" aria-label="Answer sources">
      {citations.map(citation => (
        <a
          key={citation.citation_id}
          href={`#/${citation.entity_type === 'task' ? 'tasks' : `${citation.entity_type}s`}?focus=${encodeURIComponent(citation.record_id)}`}
          title={citation.excerpt}
        >
          [{citation.citation_id}] {citation.title} · rev {citation.revision}
        </a>
      ))}
    </div>
  )
}

/** The span a repeat covers, so one preview can stand for the whole series. */
export function seriesSummary(proposal) {
  const series = proposal?.series
  if (!series || series.length < 2) return null
  const day = record => record.content?.due_date || record.content?.date || ''
  return `Creates ${series.length} records, ${day(series[0])} to ${day(series[series.length - 1])}`
}

export function ProposalCard({ proposal, onConfirm, onReject }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const act = async callback => {
    setWorking(true)
    setError('')
    try { await callback(proposal) }
    catch (actionError) { setError(actionError.message) }
    finally { setWorking(false) }
  }
  return (
    <section className={`ai-proposal ai-proposal-${proposal.status}`}>
      <div className="ai-proposal-title">
        <ShieldCheck size={14} />
        <strong>{proposal.operation} {proposal.entity_type}</strong>
        <span>{proposal.status}</span>
      </div>
      <p>{proposal.rationale}</p>
      {seriesSummary(proposal) && (
        <div className="ai-proposal-series">
          <Repeat size={12} /> {seriesSummary(proposal)}
        </div>
      )}
      <ul className="ai-proposal-change">
        {changeLines(proposal).map(line => (
          <li key={line.label}>
            <span className="ai-change-label">{line.label}</span>
            {line.from !== undefined && <span className="ai-change-from">{line.from}</span>}
            {line.from !== undefined && <span className="ai-change-arrow" aria-hidden="true">→</span>}
            <span className="ai-change-to">{line.to}</span>
          </li>
        ))}
      </ul>
      {error && <div className="ai-proposal-error">{error}</div>}
      {proposal.status === 'pending' && (
        <div className="ai-proposal-actions">
          <button disabled={working} onClick={() => act(onReject)}><X size={12} /> Reject</button>
          <button disabled={working} className="confirm" onClick={() => act(onConfirm)}>
            <ShieldCheck size={12} /> {working ? 'Applying…' : 'Confirm change'}
          </button>
        </div>
      )}
    </section>
  )
}

export function ProposalList({ proposals, onConfirm, onReject, onConfirmAll, onRejectAll }) {
  // One change is one card. Several used to be several cards each wanting its
  // own click, which is how "make this weekly for three months" turned into
  // thirteen confirmations. A batch gets one decision by default and opens up
  // when the student wants to check each one.
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const pending = (proposals || []).filter(proposal => proposal.status === 'pending')

  if (!proposals?.length) return null
  if (proposals.length === 1) {
    return <ProposalCard proposal={proposals[0]} onConfirm={onConfirm} onReject={onReject} />
  }

  const runBatch = async (kind, callback) => {
    setWorking(kind)
    setError('')
    try { await callback(pending) }
    catch (batchError) { setError(batchError.message) }
    finally { setWorking('') }
  }

  const settled = proposals.length - pending.length
  return (
    <section className="ai-proposal-group">
      <div className="ai-proposal-group-head">
        <ShieldCheck size={14} />
        <strong>{proposals.length} changes</strong>
        {settled > 0 && <span className="ai-proposal-group-done">{settled} already decided</span>}
        <button className="ai-proposal-toggle" onClick={() => setOpen(value => !value)}
          aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? 'Hide' : 'Review each'}
        </button>
      </div>
      <ul className="ai-proposal-summary">
        {proposals.map(proposal => (
          <li key={proposal.proposal_id}>
            <span className="ai-proposal-op">{proposal.operation}</span>
            <span>{changeSummary(proposal)}</span>
            {proposal.status !== 'pending' && (
              <span className="ai-proposal-status">{proposal.status}</span>
            )}
          </li>
        ))}
      </ul>
      {error && <div className="ai-proposal-error">{error}</div>}
      {pending.length > 0 && (
        <div className="ai-proposal-actions">
          <button disabled={Boolean(working)} onClick={() => runBatch('reject', onRejectAll)}>
            <X size={12} /> {working === 'reject' ? 'Rejecting…' : `Reject all ${pending.length}`}
          </button>
          <button disabled={Boolean(working)} className="confirm"
            onClick={() => runBatch('confirm', onConfirmAll)}>
            <ShieldCheck size={12} />
            {working === 'confirm' ? 'Applying…' : `Confirm all ${pending.length}`}
          </button>
        </div>
      )}
      {open && (
        <div className="ai-proposal-each">
          {proposals.map(proposal => (
            <ProposalCard key={proposal.proposal_id} proposal={proposal}
              onConfirm={onConfirm} onReject={onReject} />
          ))}
        </div>
      )}
    </section>
  )
}

export function ConversationList({ conversations, currentId, onOpen, onRename, onDelete, onClose }) {
  // Threads exist so a conversation can be returned to, which is the whole
  // reason the transcript moved to the server. The list is the way back.
  return (
    <div className="ai-threads" role="dialog" aria-label="Conversations">
      <div className="ai-threads-head">
        <strong>Conversations</strong>
        <button className="ai-header-btn" onClick={onClose} aria-label="Close conversations">
          <X size={14} />
        </button>
      </div>
      {!conversations.length && (
        <p className="ai-threads-empty">Nothing yet. Whatever you ask starts one.</p>
      )}
      <ul>
        {conversations.map(thread => (
          <li key={thread.conversation_id}
            className={thread.conversation_id === currentId ? 'current' : undefined}>
            <button className="ai-thread-open" onClick={() => onOpen(thread.conversation_id)}>
              <MessageSquare size={11} aria-hidden="true" />
              <span className="ai-thread-title">{thread.title}</span>
              <span className="ai-thread-count">{thread.message_count}</span>
            </button>
            <button className="ai-thread-action" aria-label={`Rename "${thread.title}"`}
              onClick={() => {
                const title = window.prompt('Rename conversation', thread.title)
                if (title?.trim()) onRename(thread.conversation_id, title.trim())
              }}>
              <Pencil size={11} />
            </button>
            <button className="ai-thread-action danger" aria-label={`Delete "${thread.title}"`}
              onClick={() => onDelete(thread.conversation_id)}>
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AiSidebar() {
  const {
    poppedOut, togglePopOut, messages, typing, sendMessage, cancelResponse, available,
    clearChat, confirmProposal, rejectProposal, confirmProposals, rejectProposals,
    aiInfo, noticeAcknowledged, acknowledgeNotice,
    conversationId, conversations, openConversation, newConversation,
    renameConversation, deleteConversation,
  } = useAi()
  const [showThreads, setShowThreads] = useState(false)
  const location = useLocation()
  // The pop-out lives in the dashboard grid, so it only applies on the
  // dashboard route. On every other page the assistant always stays in the
  // sidebar (collapsible/expandable) regardless of the popped-out preference.
  const isDashboard = location.pathname === '/'
  const effectivePopped = poppedOut && isDashboard
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('nw_ai_sidebar') === 'collapsed'
  )
  const [input, setInput] = useState('')
  // Once the answer starts arriving there is something to read, so the
  // thinking indicator would just be noise sitting under live text.
  const awaitingFirstToken = typing && !messages.some(message => message.streaming)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  /* Sync sidebar state to DOM for CSS margin coordination */
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-ai-sidebar',
      effectivePopped ? 'popped' : collapsed ? 'collapsed' : 'expanded'
    )
  }, [collapsed, effectivePopped])

  // Follow the answer only while the student is already at the bottom. It used
  // to scroll on every streamed token, which yanked the view back down the
  // moment anyone scrolled up to read an earlier answer or a proposal preview.
  useEffect(() => {
    const list = bottomRef.current?.parentElement
    if (!list) return
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight
    if (distance > 120) return
    bottomRef.current.scrollIntoView({ block: 'end' })
  }, [messages, typing])

  useEffect(() => {
    if (!collapsed && !effectivePopped) inputRef.current?.focus()
  }, [collapsed, effectivePopped])

  /* When popped out on the dashboard, render nothing — chat lives in the grid */
  if (effectivePopped) return null

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('nw_ai_sidebar', next ? 'collapsed' : 'expanded')
  }

  const handleSend = () => {
    sendMessage(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <aside className={`ai-sidebar${collapsed ? ' ai-collapsed' : ''}`}>
      {collapsed ? (
        <div className="ai-collapsed-bar">
          <button className="ai-collapsed-btn" onClick={toggle} title="Open AI Assistant">
            <Bot size={20} />
          </button>
          <span className="ai-collapsed-label">AI</span>
        </div>
      ) : (
        <>
          <div className="ai-sidebar-header">
            <div className="ai-sidebar-title">
              <Bot size={18} />
              <span>AI Assistant</span>
              <span className="ai-badge">Beta</span>
            </div>
            <div className="ai-header-actions">
              <button className="ai-header-btn" onClick={newConversation} title="New conversation">
                <Plus size={15} />
              </button>
              <button className="ai-header-btn" onClick={() => setShowThreads(value => !value)}
                title="Conversations" aria-expanded={showThreads}>
                <MessageSquare size={14} />
              </button>
              {isDashboard && (
                <button className="ai-header-btn" onClick={togglePopOut} title="Pop out to dashboard">
                  <ExternalLink size={14} />
                </button>
              )}
              <button className="ai-header-btn" onClick={clearChat} title="Clear chat">
                <Trash2 size={14} />
              </button>
              <button className="ai-header-btn" onClick={toggle} title="Collapse">
                <PanelRightClose size={16} />
              </button>
            </div>
          </div>

          {showThreads && (
            <ConversationList conversations={conversations} currentId={conversationId}
              onOpen={id => { openConversation(id); setShowThreads(false) }}
              onRename={renameConversation} onDelete={deleteConversation}
              onClose={() => setShowThreads(false)} />
          )}

          <div className="ai-messages">
            {available && !noticeAcknowledged && (
              <FirstRunNotice info={aiInfo} onAcknowledge={acknowledgeNotice} />
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`ai-msg ai-msg-${msg.role}`}>
                {msg.role === 'bot' && (
                  <div className="ai-msg-avatar"><Bot size={14} /></div>
                )}
                <div className="ai-msg-content">
                  <AgentSteps steps={msg.steps} />
                  {(msg.text || !msg.streaming) && (
                    <div className="ai-msg-bubble">
                      {msg.text}
                      {msg.streaming && <span className="ai-caret" aria-hidden="true" />}
                    </div>
                  )}
                  <CitationList citations={msg.citations} />
                  {msg.retrieval?.attempted && (
                    <div className="ai-retrieval-disclosure">
                      {msg.retrieval.abstained
                        ? `Abstained: ${msg.retrieval.reason || 'insufficient approved evidence'}`
                        : `Retrieved ${msg.retrieval.result_count} approved record${msg.retrieval.result_count === 1 ? '' : 's'}`}
                    </div>
                  )}
                  <ProposalList proposals={msg.proposals}
                    onConfirm={confirmProposal} onReject={rejectProposal}
                    onConfirmAll={confirmProposals} onRejectAll={rejectProposals} />
                </div>
              </div>
            ))}
            {awaitingFirstToken && <ThinkingIndicator onCancel={cancelResponse} />}

            {available && messages.length <= 2 && !typing && (
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="ai-suggestion" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {!available && (
              <div className="ai-unavailable">
                The copilot needs the planner backend, which this build is not connected to.
                Your tasks, reminders, and notes still work — they are stored encrypted on this
                device.
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="ai-input-bar">
            <textarea
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={available ? 'Ask anything...' : 'Copilot unavailable in this build'}
              rows={1}
              disabled={!available}
            />
            <button
              className={`ai-send${input.trim() ? ' ai-send-active' : ''}`}
              onClick={handleSend}
              disabled={!available || !input.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
