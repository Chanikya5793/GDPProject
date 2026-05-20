const STORAGE_KEY = 'nw_categories'

const BUILT_IN = [
    { id: 'homework', name: 'Homework', color: '#3B82F6', builtin: true },
    { id: 'exam', name: 'Exam', color: '#DC2626', builtin: true },
    { id: 'project', name: 'Project', color: '#7C3AED', builtin: true },
    { id: 'reading', name: 'Reading', color: '#D97706', builtin: true },
    { id: 'lab', name: 'Lab', color: '#16A34A', builtin: true },
]

function loadCustom() {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
}

function saveCustom(cats) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cats))
}

export async function getCategories(userId) {
    const custom = loadCustom().filter(c => c.userId === userId)
    return [...BUILT_IN, ...custom]
}

export async function createCategory(category) {
    const custom = loadCustom()
    const newCat = { ...category, id: `custom_${Date.now()}`, builtin: false }
    saveCustom([...custom, newCat])
    return newCat
}

export async function deleteCategory(id) {
    saveCustom(loadcustom().filter(c => c.id !== id))
    return { success: true }
}