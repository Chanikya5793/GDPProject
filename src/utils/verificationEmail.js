// A successful Firebase request means accepted for sending, not delivered.
export function verificationMessage(error) {
  switch (error?.code) {
    case 'auth/too-many-requests':
      return 'Email requests are temporarily limited. Wait a few minutes before trying again. This does not confirm delivery.'
    case 'auth/quota-exceeded':
      return 'The email service has reached its sending limit. Please try again later.'
    case 'auth/network-request-failed':
      return 'Could not reach the email service. Check your connection and try Resend.'
    case 'auth/user-token-expired':
    case 'auth/invalid-user-token':
      return 'Your session has expired. Sign out and sign in again, then try Resend.'
    default:
      return 'The verification email could not be requested. Try Resend. If it keeps failing, contact support.'
  }
}

// Coalesce rapid signup/resend requests, including callers outside the banner.
// Keep accounts and changed addresses separate; never retry a send automatically.
export function createVerificationSender(send) {
  const pending = new Map()
  return user => {
    const key = JSON.stringify([user.uid, user.email])
    if (pending.has(key)) return pending.get(key)
    const request = Promise.resolve().then(() => send(user)).then(() => Date.now())
      .finally(() => { pending.delete(key) })
    pending.set(key, request)
    return request
  }
}
