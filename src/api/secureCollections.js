import { getSecureItem, setSecureItem, updateSecureItem } from '../security/cryptoStore'

export function authenticatedUid() {
  const uid = sessionStorage.getItem('nw_authenticated_uid')
  if (!uid) throw new Error('Sign in is required')
  return uid
}

export function getSecureCollection(namespace, fallback = []) {
  return getSecureItem(authenticatedUid(), namespace, fallback)
}

export function setSecureCollection(namespace, value) {
  return setSecureItem(authenticatedUid(), namespace, value)
}


/** Read-modify-write one collection with no other writer in between. */
export function updateSecureCollection(namespace, fallback, updater) {
  return updateSecureItem(authenticatedUid(), namespace, fallback, updater)
}
