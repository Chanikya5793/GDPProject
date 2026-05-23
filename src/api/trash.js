const TRASH_KEY = 'nw_trash'

function load() {
    const raw = localStorage.getItem(TRASH_KEY)
    return raw ? JSON.parse(raw) : []
}

function save(items) {
    localStorage.setItem(TRASH_KEY, JSON.stringify(items))
}

export async function getTrash(userId) {
    return load().filter(t => t.userId === userId)
}

export async function addToTrash(item, type) {
    const trash = load()
    trash.unshift({
        ...item,
        _trashType: type,
        _deletedAt: new Date().toISOString(),
    })
    save(trash)
}

export async function restoreFromTrash(id) {
    const trash = load()
    const item = trash.find(t => t.id === id)
    if (!item) return null
    save(trash.filter(t => t.id !== id))
    const { _trashType, _deletedAt, ...restored } = item
    return { item: restored, type: _trashType }
}

export async function permanentDelete(id) {
    const trash = load()
    save(trash.filter(t => t.id !== id))
}

export async function emptyTrash(userId) {
    const trash = load()
    save(trash.filter(t => t.userId !== userId))
}

export async function getTrashCount(userId) {
    return load().filter(t => t.userId === userId).length
}
