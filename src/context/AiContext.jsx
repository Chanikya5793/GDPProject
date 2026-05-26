import { createContext, useContext, useState, useCallback } from 'react'

const AiContext = createContext()

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

export function AiProvider({ children }) {
  const [poppedOut, setPoppedOut] = useState(() =>
    localStorage.getItem('nw_ai_popped') === 'true'
  )
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'bot',
      text: "Hi! I'm your Northwest Planner assistant. I can help you manage tasks, reminders, notes, and more. What can I help you with?",
    },
  ])
  const [typing, setTyping] = useState(false)

  const togglePopOut = useCallback(() => {
    setPoppedOut(prev => {
      const next = !prev
      localStorage.setItem('nw_ai_popped', next ? 'true' : 'false')
      return next
    })
  }, [])

  const sendMessage = useCallback((text) => {
    if (!text.trim()) return
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', text }])
    setTyping(true)
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'bot',
        text: getSkeletonResponse(text),
      }])
      setTyping(false)
    }, 1200 + Math.random() * 800)
  }, [])

  const clearChat = useCallback(() => {
    setMessages([{
      id: Date.now(),
      role: 'bot',
      text: "Chat cleared! How can I help you?",
    }])
  }, [])

  return (
    <AiContext.Provider value={{ poppedOut, togglePopOut, messages, typing, sendMessage, clearChat }}>
      {children}
    </AiContext.Provider>
  )
}

export function useAi() {
  return useContext(AiContext)
}
