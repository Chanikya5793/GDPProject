import { addLog } from './logs'
import { apiConfigured, apiFetch } from './client'
import { authenticatedUid, getSecureCollection, setSecureCollection, updateSecureCollection } from './secureCollections'

const LEGACY = 'metadata:tags'
const CATALOG = 'metadata:shared-tags'
const DEFAULT_TAGS = [
  { id: 'chemistry', name: 'Chemistry', color: '#DBEAFE' },
  { id: 'cs', name: 'CS', color: '#DCFCE7' },
  { id: 'history', name: 'History', color: '#FEF3C7' },
  { id: 'study-tips', name: 'Study Tips', color: '#F3E8FF' },
]

function tagPath(id) {
  return `/v1/tags/${encodeURIComponent(id)}`
}

function putTag({ id, name, color }, uid, importOnly = false) {
  return apiFetch(tagPath(id) + (importOnly ? '?import_only=true' : ''), {
    method: 'PUT', body: JSON.stringify({ name, color }),
  }, uid)
}

export async function getTags() {
  const uid = authenticatedUid()
  const legacy = await getSecureCollection(LEGACY, DEFAULT_TAGS)
  if (!apiConfigured()) return legacy
  const cached = await getSecureCollection(CATALOG, null)
  try {
    if (cached === null) {
      for (const tag of legacy) {
        if (authenticatedUid() !== uid) throw new Error('Account changed.')
        await putTag(tag, uid, true)
      }
    }
    if (authenticatedUid() !== uid) throw new Error('Account changed.')
    const tags = await apiFetch('/v1/tags', {}, uid)
    if (authenticatedUid() !== uid) throw new Error('Account changed.')
    await setSecureCollection(CATALOG, tags)
    return tags
  } catch (error) {
    if (authenticatedUid() !== uid) throw error
    return cached ?? legacy.map(tag => ({ ...tag, id: String(tag.id) }))
  }
}

function mutateTags(updater) {
  return updateSecureCollection(apiConfigured() ? CATALOG : LEGACY, DEFAULT_TAGS, updater)
}

export async function createTag(tag) {
  const created = { ...tag, id: `tag_${crypto.randomUUID()}` }
  await restoreTagDirect(created)
  await addLog('created', 'tag', created.name, { entityId: created.id, after: created })
  return created
}

export async function updateTag(id, updates) {
  const uid = authenticatedUid()
  const before = (await getTags()).find(tag => String(tag.id) === String(id))
  if (!before || authenticatedUid() !== uid) throw new Error('Tag is no longer available.')
  const tag = { ...before, ...updates, id: before.id }
  if (apiConfigured()) await putTag(tag, uid)
  if (authenticatedUid() !== uid) throw new Error('Account changed.')
  await mutateTags(tags => tags.map(item => String(item.id) === String(id) ? tag : item))
  await addLog('updated', 'tag', tag.name, { entityId: id, before, after: tag })
  return tag
}

export async function deleteTag(id) {
  const uid = authenticatedUid()
  const tag = (await getTags()).find(item => String(item.id) === String(id))
  if (authenticatedUid() !== uid) throw new Error('Account changed.')
  if (apiConfigured()) await apiFetch(tagPath(id), { method: 'DELETE' }, uid)
  if (authenticatedUid() !== uid) throw new Error('Account changed.')
  await mutateTags(tags => tags.filter(item => String(item.id) !== String(id)))
  // Existing records keep the reference so restoring a tag restores its links.
  await addLog('deleted', 'tag', tag?.name, { entityId: id, before: tag })
  return { success: true }
}

export async function restoreTagDirect(tag) {
  const uid = authenticatedUid()
  if (apiConfigured()) {
    await getTags()
    if (authenticatedUid() !== uid) throw new Error('Account changed.')
    await putTag(tag, uid)
  }
  if (authenticatedUid() !== uid) throw new Error('Account changed.')
  await mutateTags(tags => (
    tags.some(item => String(item.id) === String(tag.id)) ? undefined : [...tags, tag]
  ))
}
