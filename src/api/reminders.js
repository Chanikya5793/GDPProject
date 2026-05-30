import { addToTrash } from './trash'
import { addLog } from './logs'

const STORAGE_KEY = 'nw_reminders'

function load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : defaultReminders()
}

function save(reminders) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders))
}

function defaultReminders() {
    return [
        {
            id: 1,
            userId: 1,
            title: 'Advisor Meeting',
            date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            time: '10:00',
            notes: 'Discuss spring course schedule',
            createdAt: new Date().toISOString(),
        },
        {
            id: 2,
            userId: 1,
            title: 'Study Group - Library room 204',
            date: new Date(Date.now() + 172800000).toISOString().split('T')[0],
            time: '14:00',
            notes: 'Bring organic chemistry notes',
            createdAt: new Date().toISOString(),
        },
        {
            id: 3,
            userId: 1,
            title: 'Office Hours - Prof. Fellah',
            date: new Date(Date.now() + 259200000).toISOString().split('T')[0],
            time: '09:30',
            notes: 'Ask about assignment formatting',
            createdAt: new Date().toISOString(),
        },
    ]
}

// TODO: API functions
export async function getReminders(userId) {
    return load().filter(r => r.userId === userId)
}

export async function createReminder(reminder) {
    const reminders = load()
    const newReminder = {
        ...reminder,
        id: Date.now(),
        createdAt: new Date().toISOString(),
    }
    save([...reminders, newReminder])
    addLog('created', 'reminder', newReminder.title)
    return newReminder
}

export async function updateReminder(id, updates) {
    const reminders = load()
    const updated = reminders.map(r => r.id === id ? { ...r, ...updates } : r)
    save(updated)
    const reminder = updated.find(r => r.id === id)
    addLog('updated', 'reminder', reminder?.title)
    return reminder
}

export async function deleteReminder(id) {
    const reminders = load()
    const reminder = reminders.find(r => r.id === id)
    if (reminder) await addToTrash(reminder, 'reminder')
    save(reminders.filter(r => r.id !== id))
    addLog('deleted', 'reminder', reminder?.title)
    return { success: true }
}

export function restoreReminderDirect(reminder) {
    const reminders = load()
    reminders.push(reminder)
    save(reminders)
}
