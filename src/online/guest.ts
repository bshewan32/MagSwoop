import { createTRPCUntypedClient, httpLink } from '@trpc/client'
import superjson from 'superjson'

/**
 * Guest identity for the shop: no login needed. The restore code is a random 80-bit secret
 * (MAG-XXXX-XXXX-XXXX-XXXX) kept in this browser and sent as X-Guest-Token; purchases belong to it.
 * Typing it on another device restores the same purchases.
 */
const KEY = 'magswoop.restoreCode'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I, L, O, U)
export const CODE_RE = /^MAG(-[0-9A-HJKMNP-TV-Z]{4}){4}$/

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let body = ''
  for (const b of bytes) body += ALPHABET[b & 31]
  return `MAG-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`
}

/** Tidy a typed/pasted code (case, spaces, O→0, I/L→1); null if it isn't a valid code. */
export function normaliseCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (c.length !== 19 || !c.startsWith('MAG')) return null
  const b = c.slice(3)
  const code = `MAG-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}`
  return CODE_RE.test(code) ? code : null
}

let memo: string | null = null
export function restoreCode(): string {
  if (memo) return memo
  let code: string | null = null
  try {
    code = localStorage.getItem(KEY)
  } catch {
    code = null
  }
  if (!code || !CODE_RE.test(code)) {
    code = newCode()
    try {
      localStorage.setItem(KEY, code)
    } catch {
      // private mode: the code lives for this session only
    }
  }
  memo = code
  return code
}

export function setRestoreCode(code: string): void {
  memo = code
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // ignore
  }
}

// Same URL handling as the platform login bridge (works inside the preview iframe path too).
const pathname = location.pathname
const marker = pathname.indexOf('/__manus__/game-preview/')
const prefix = marker < 0 ? '' : pathname.slice(0, marker)

const client = createTRPCUntypedClient({
  links: [httpLink({
    url: `${prefix}/api/trpc`,
    transformer: superjson,
    headers: () => ({ 'X-Guest-Token': restoreCode() }),
    async fetch(url, options) {
      const response = await fetch(url, { ...(options as RequestInit), credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(35_000) })
      if (response.status === 503 && (await response.clone().json().catch(() => null))?.error === 'online_preview_requires_checkpoint') {
        throw new Error('online_preview_requires_checkpoint')
      }
      return response
    },
  })],
})

export const api = {
  query<T>(path: string, input?: unknown): Promise<T> {
    return client.query(`game.${path}`, input) as Promise<T>
  },
  mutate<T>(path: string, input?: unknown): Promise<T> {
    return client.mutation(`game.${path}`, input) as Promise<T>
  },
}
