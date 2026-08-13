/**
 * Local stand-in for netlify/functions/room.ts.
 *
 * Netlify Blobs only exists inside the Netlify runtime, so `vite dev` would
 * otherwise have no room API at all and multiplayer would be untestable
 * locally. This mounts the *same* pure handler on /api/room over an in-memory
 * Map, which means local dev exercises the real sequencer logic — only the
 * storage differs. Runs for both `vite dev` and `vite preview`.
 */

import type { Connect, Plugin, ViteDevServer, PreviewServer } from 'vite'
import {
  WRONG_KEY_DELAY_MS,
  issueToken,
  pause,
  safeEqual,
  siteKey,
  verifyToken,
} from '../server/gateToken.ts'
import type { RoomReq } from '../shared/protocol.ts'
import { handleRoomRequest } from '../shared/roomHandler.ts'
import type { RoomDoc, RoomStore, Stored } from '../shared/roomHandler.ts'

const ROOM_ROUTE = '/api/room'
const GATE_ROUTE = '/api/gate'

function memoryStore(): RoomStore {
  // `version` stands in for the etag so the compare-and-swap path is exercised
  // locally exactly as it is in production.
  const rooms = new Map<string, { doc: RoomDoc; version: number }>()
  let counter = 0

  return {
    async read(code): Promise<Stored | null> {
      const hit = rooms.get(code)
      if (!hit) return null
      return { doc: structuredClone(hit.doc), version: String(hit.version) }
    },

    async write(code, doc, prev): Promise<boolean> {
      const current = rooms.get(code)
      if (prev?.version) {
        if (!current || String(current.version) !== prev.version) return false
      } else if (current) {
        return false
      }
      rooms.set(code, { doc: structuredClone(doc), version: ++counter })
      return true
    },

    async remove(code): Promise<void> {
      rooms.delete(code)
    },
  }
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

export function devRoomServer(): Plugin {
  const store = memoryStore()

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (url !== ROOM_ROUTE && url !== GATE_ROUTE) return next()

    const send = (payload: unknown, status: number) => {
      const text = JSON.stringify(payload)
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
    }

    // Mirrors netlify/functions/gate.ts. Set ARCADE_KEY before `npm run dev`
    // to exercise the key screen locally; unset, the gate is simply off.
    const key = siteKey()

    if (url === GATE_ROUTE) {
      if (req.method === 'GET') return send({ required: !!key }, 200)
      if (req.method !== 'POST') return send({ ok: false, error: 'BAD_REQUEST' }, 405)
      if (!key) return send({ ok: true, required: false, token: null }, 200)
      try {
        const submitted = (JSON.parse(await readBody(req)) as { key?: unknown }).key
        if (typeof submitted !== 'string' || !safeEqual(submitted.trim(), key)) {
          await pause(WRONG_KEY_DELAY_MS)
          return send({ ok: false, error: 'BAD_KEY' }, 401)
        }
        return send({ ok: true, required: true, token: issueToken(key) }, 200)
      } catch {
        return send({ ok: false, error: 'BAD_REQUEST' }, 400)
      }
    }

    if (req.method !== 'POST') return send({ ok: false, error: 'BAD_REQUEST' }, 405)

    if (key && !verifyToken(req.headers['x-arcade-token'] as string | undefined, key)) {
      return send({ ok: false, error: 'LOCKED' }, 401)
    }

    try {
      const body = JSON.parse(await readBody(req)) as RoomReq
      const result = await handleRoomRequest(store, body)
      send(result, result.ok ? 200 : 400)
    } catch (error) {
      console.error('[dev room]', error)
      send({ ok: false, error: 'SERVER' }, 500)
    }
  }

  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware)
  }

  return {
    name: 'arcade-dev-room-server',
    configureServer: mount,
    configurePreviewServer: mount,
  }
}
