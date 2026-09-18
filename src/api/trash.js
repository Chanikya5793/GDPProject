import { getSecureCollection, updateSecureCollection } from './secureCollections'

const NAMESPACE = 'records:trash'

async function load() {
  return getSecureCollection(NAMESPACE, [])
}

function mutate(updater) {
  return updateSecureCollection(NAMESPACE, [], updater)
}

export async function getTrash() {
  return load()
}

export async function addToTrash(item, type) {
  const trashId = `${type}_${item.id}_${crypto.randomUUID()}`
  await mutate(trash => [{ ...item, _trashId: trashId, _trashType: type,
    _deletedAt: new Date().toISOString() }, ...trash])
  return trashId
}

function stripTrashFields(item) {
  const restored = { ...item }
  delete restored._trashId
  delete restored._trashType
  delete restored._deletedAt
  return restored
}

/**
 * Take an item out of the bin.
 *
 * `restore(item, type)` runs first and the row is removed only once it has
 * succeeded. The row used to go first, so a failed re-create -- the record
 * still existed on the server, the network dropped -- left the item nowhere.
 */
export async function restoreFromTrash(trashId, restore) {
  const item = (await load()).find(value => value._trashId === trashId)
  if (!item) return null
  const result = { item: stripTrashFields(item), type: item._trashType }
  if (restore) await restore(result.item, result.type)
  await mutate(trash => trash.filter(value => value._trashId !== trashId))
  return result
}

export async function permanentDelete(trashId) {
  await mutate(trash => trash.filter(value => value._trashId !== trashId))
}

export async function emptyTrash() {
  await mutate(() => [])
}

export async function getTrashCount() {
  return (await load()).length
}
