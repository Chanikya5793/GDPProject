import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot, Send, Trash2, PanelRightClose, ExternalLink, Square, ShieldCheck, X } from 'lucide-react'
import { useAi } from '../context/AiContext'
import '../css/AiSidebar.css'

const SUGGESTIONS = [
  'What tasks are due today?',
  'Create a new task for tomorrow',
  'Show my overdue items',
  'Summarize my week ahead',
]

export function ThinkingIndicator({ onCancel }) {
  return (
    <div className="ai-msg ai-msg-bot">
      <div className="ai-msg-avatar"><Bot size={14} /></div>
      <div className="ai-msg-bubble ai-thinking">
        <span>Retrieving approved records…</span>
        <button onClick={onCancel}><Square size={11} /> Stop</button>
      </div>
    </div>
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
      <div className="ai-proposal-preview">
        <div><span>Before</span><pre>{proposal.before ? JSON.stringify(proposal.before, null, 2) : 'Does not exist'}</pre></div>
        <div><span>After</span><pre>{proposal.after ? JSON.stringify(proposal.after, null, 2) : 'Deleted'}</pre></div>
      </div>
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

export default function AiSidebar() {
  const {
    poppedOut, togglePopOut, messages, typing, sendMessage, cancelResponse,
    clearChat, confirmProposal, rejectProposal,
  } = useAi()
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
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  /* Sync sidebar state to DOM for CSS margin coordination */
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-ai-sidebar',
      effectivePopped ? 'popped' : collapsed ? 'collapsed' : 'expanded'
    )
  }, [collapsed, effectivePopped])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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

          <div className="ai-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`ai-msg ai-msg-${msg.role}`}>
                {msg.role === 'bot' && (
                  <div className="ai-msg-avatar"><Bot size={14} /></div>
                )}
                <div className="ai-msg-content">
                  <div className="ai-msg-bubble">{msg.text}</div>
                  <CitationList citations={msg.citations} />
                  {msg.retrieval?.attempted && (
                    <div className="ai-retrieval-disclosure">
                      {msg.retrieval.abstained
                        ? `Abstained: ${msg.retrieval.reason || 'insufficient approved evidence'}`
                        : `Retrieved ${msg.retrieval.result_count} approved record${msg.retrieval.result_count === 1 ? '' : 's'}`}
                    </div>
                  )}
                  {msg.proposals?.map(proposal => (
                    <ProposalCard key={proposal.proposal_id} proposal={proposal}
                      onConfirm={confirmProposal} onReject={rejectProposal} />
                  ))}
                </div>
              </div>
            ))}
            {typing && <ThinkingIndicator onCancel={cancelResponse} />}

            {messages.length <= 2 && !typing && (
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} className="ai-suggestion" onClick={() => sendMessage(s)}>
                    {s}
                  </button>
                ))}
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
              placeholder="Ask anything..."
              rows={1}
            />
            <button
              className={`ai-send${input.trim() ? ' ai-send-active' : ''}`}
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
