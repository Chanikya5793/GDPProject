const TRASH_KEY = 'nw_trash'

function load() {
    try {
        const raw = localStorage.getItem(TRASH_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        localStorage.removeItem(TRASH_KEY)
        return []
    }
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
        _trashId: `${type}_${item.id}_${Date.now()}`,
        _trashType: type,
        _deletedAt: new Date().toISOString(),
    })
    save(trash)
}

export async function restoreFromTrash(trashId) {
    const trash = load()
    const item = trash.find(t => t._trashId === trashId)
    if (!item) return null
    save(trash.filter(t => t._trashId !== trashId))
    const { _trashId, _trashType, _deletedAt, ...restored } = item
    return { item: restored, type: _trashType }
}

export async function permanentDelete(trashId) {
    const trash = load()
    save(trash.filter(t => t._trashId !== trashId))
}

export async function emptyTrash(userId) {
    const trash = load()
    save(trash.filter(t => t.userId !== userId))
}

export async function getTrashCount(userId) {
    return load().filter(t => t.userId === userId).length
}
