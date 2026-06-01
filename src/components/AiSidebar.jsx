import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot, Send, Trash2, PanelRightClose, ExternalLink } from 'lucide-react'
import { useAi } from '../context/AiContext'
import '../css/AiSidebar.css'

const SUGGESTIONS = [
  'What tasks are due today?',
  'Create a new task for tomorrow',
  'Show my overdue items',
  'Summarize my week ahead',
]

function TypingIndicator() {
  return (
    <div className="ai-msg ai-msg-bot">
      <div className="ai-msg-avatar"><Bot size={14} /></div>
      <div className="ai-msg-bubble ai-typing">
        <span /><span /><span />
      </div>
    </div>
  )
}

export default function AiSidebar() {
  const { poppedOut, togglePopOut, messages, typing, sendMessage, clearChat } = useAi()
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
                <div className="ai-msg-bubble">{msg.text}</div>
              </div>
            ))}
            {typing && <TypingIndicator />}

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
