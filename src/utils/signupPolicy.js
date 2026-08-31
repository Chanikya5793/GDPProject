// Mirrors the precedence in backend/app/signup_policy.py so the sign-up form can
// refuse an ineligible address before an account is created. Advisory only —
// the binding check runs server-side on every request, because the Firebase web
// API key is public and anyone can create an account without this form.

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

/**
 * The reason this address may not register, or null when it may.
 * A null or unreadable policy means "do not block" — the server still decides.
 */
export function refusalFor(email, policy) {
  if (!policy || policy.enforce === false) return null
  const domains = (policy.allowed_domains || []).map(normalizeEmail)
  if (domains.length === 0) return null

  const address = normalizeEmail(email)
  if (!address || !address.includes('@')) return null // let the form's own validation speak

  const domain = address.slice(address.lastIndexOf('@') + 1)
  if (domains.includes(domain)) return null
  return policy.message || `This planner is limited to ${domains.map(d => `@${d}`).join(', ')} accounts.`
}
