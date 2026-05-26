import { addToTrash } from './trash'

const STORAGE_KEY = 'nw_tasks'

function load() {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : defaultTasks()
}

function save(tasks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

function defaultTasks() {
    return [
        {
            id: 1,
            userId: 1,
            title: 'Read Chapter 5 - Organic Chemistry',
            dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            dueTime: '23:59',
            priority: 'high',
            category: 'Reading',
            notes: 'Focus on the different compounds',
            completed: false,
            createdAt: new Date().toISOString(),
        },
        {
            id: 2,
            userId: 1,
            title: 'Complete Lab Report',
            dueDate: new Date(Date.now() + 172800000).toISOString().split('T')[0],
            dueTime: '17:00',
            priority: 'high',
            category: 'Lab',
            notes: 'Include all data tables',
            completed: false,
            createdAt: new Date().toISOString(),
        },
        {
            id: 3,
            userId: 1,
            title: 'Study for CS Midterm',
            dueDate: new Date(Date.now() + 432000000).toISOString().split('T')[0],
            dueTime: '',
            priority: 'medium',
            category: 'Exam',
            notes: 'Chapters 1-6',
            completed: false,
            createdAt: new Date().toISOString(),
        },
        {
            id: 4,
            userId: 1,
            title: 'Submit History Essay',
            dueDate: new Date(Date.now() - 86400000).toISOString().split('T')[0],
            dueTime: '23:59',
            priority: 'high',
            category: 'Homework',
            notes: '',
            completed: true,
            createdAt: new Date().toISOString(),
        },
    ]
}

// TODO: API functions
export async function getTasks(userId) {
    return load().filter(t => t.userId === userId)
}

export async function createTask(task) {
    const tasks = load()
    const newTask = {
        ...task,
        id: Date.now(),
        completed: false,
        createdAt: new Date().toISOString(),
    }
    save([...tasks, newTask])
    return newTask
}

export async function updateTask(id, updates) {
    const tasks = load()
    const updated = tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    save(updated)
    return updated.find(t => t.id === id)
}

export async function deleteTask(id) {
    const tasks = load()
    const task = tasks.find(t => t.id === id)
    if (task) await addToTrash(task, 'task')
    save(tasks.filter(t => t.id !== id))
    return { success: true }
}

export function restoreTaskDirect(task) {
    const tasks = load()
    tasks.push(task)
    save(tasks)
}

export async function toggleTask(id) {
    const tasks = load()
    const updated = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
    save(updated)
    return updated.find(t => t.id === id)
}
