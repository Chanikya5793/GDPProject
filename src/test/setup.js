import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach } from 'vitest'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

// Testing Library only registers its own cleanup when the test framework's
// globals are exposed, and they are not here. Without this every render stays
// mounted, so a later test can match markup from an earlier one.
afterEach(cleanup)
