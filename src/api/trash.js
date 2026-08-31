import { getSecureCollection, setSecureCollection } from './secureCollections'

const NAMESPACE = 'records:trash'

async function load() {
  return getSecureCollection(NAMESPACE, [])
}

async function save(items) {
  return setSecureCollection(NAMESPACE, items)
}

export async function getTrash() {
  return load()
}

export async function addToTrash(item, type) {
  const trash = await load()
  const trashId = `${type}_${item.id}_${crypto.randomUUID()}`
  await save([{ ...item, _trashId: trashId, _trashType: type,
    _deletedAt: new Date().toISOString() }, ...trash])
  return trashId
}

export async function restoreFromTrash(trashId) {
  const trash = await load()
  const item = trash.find(value => value._trashId === trashId)
  if (!item) return null
  await save(trash.filter(value => value._trashId !== trashId))
  const { _trashType } = item
  const restored = { ...item }
  delete restored._trashId
  delete restored._trashType
  delete restored._deletedAt
  return { item: restored, type: _trashType }
}

export async function permanentDelete(trashId) {
  await save((await load()).filter(value => value._trashId !== trashId))
}

export async function emptyTrash() {
  await save([])
}

export async function getTrashCount() {
  return (await load()).length
}
