import { useState, useRef, useEffect } from 'react'
import { Bot, Send, Trash2, PanelRightClose, PanelRightOpen } from 'lucide-react'
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
  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem('nw_ai_sidebar') === 'collapsed'
  )
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'bot',
      text: "Hi! I'm your Northwest Planner assistant. I can help you manage tasks, reminders, notes, and more. What can I help you with?",
    },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Sync sidebar state to DOM for CSS
  useEffect(() => {
    document.documentElement.setAttribute(
      'data-ai-sidebar',
      collapsed ? 'collapsed' : 'expanded'
    )
  }, [collapsed])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus()
  }, [collapsed])

  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('nw_ai_sidebar', next ? 'collapsed' : 'expanded')
  }

  const sendMessage = (text) => {
    if (!text.trim()) return
    const userMsg = { id: Date.now(), role: 'user', text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setTyping(true)

    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'bot',
        text: getSkeletonResponse(text),
      }])
      setTyping(false)
    }, 1200 + Math.random() * 800)
  }

  const handleSend = () => sendMessage(input)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setMessages([{
      id: Date.now(),
      role: 'bot',
      text: "Chat cleared! How can I help you?",
    }])
  }

  return (
    <aside className={`ai-sidebar${collapsed ? ' ai-collapsed' : ''}`}>
      {collapsed ? (
        /* ─── Collapsed strip ─── */
        <div className="ai-collapsed-bar">
          <button className="ai-collapsed-btn" onClick={toggle} title="Open AI Assistant">
            <Bot size={20} />
          </button>
          <span className="ai-collapsed-label">AI</span>
        </div>
      ) : (
        /* ─── Full sidebar ─── */
        <>
          <div className="ai-sidebar-header">
            <div className="ai-sidebar-title">
              <Bot size={18} />
              <span>AI Assistant</span>
              <span className="ai-badge">Beta</span>
            </div>
            <div className="ai-header-actions">
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

function getSkeletonResponse(input) {
  const lower = input.toLowerCase()
  if (lower.includes('due today') || lower.includes('today'))
    return "You have tasks and reminders due today. I'd pull them from your dashboard, but I'm still in skeleton mode! This feature is coming soon."
  if (lower.includes('create') || lower.includes('add') || lower.includes('new'))
    return "I can help create tasks, reminders, and notes. Once connected, I'll handle that for you right from this chat!"
  if (lower.includes('overdue'))
    return "I can see you have some overdue items. Once fully wired up, I'll list them here with options to reschedule or complete them."
  if (lower.includes('summarize') || lower.includes('summary') || lower.includes('week'))
    return "Here's what your week looks like: I'll soon be able to give you a full breakdown of upcoming tasks, reminders, and deadlines!"
  if (lower.includes('help'))
    return "I can help you with:\n- Managing tasks (create, edit, complete)\n- Setting reminders\n- Taking notes\n- Viewing your calendar\n- Summarizing your schedule\n\nJust ask!"
  return "That's a great question! I'm currently in demo mode, but once fully connected I'll be able to help with all your planner needs."
}
