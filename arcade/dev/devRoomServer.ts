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
import { authorised, loginRequired } from '../server/login.ts'
import type { RoomReq } from '../shared/protocol.ts'
import { DEFAULT_HOLD, handleRoomRequest } from '../shared/roomHandler.ts'
import type { RoomDoc, RoomStore, Stored } from '../shared/roomHandler.ts'
import { accountsEnabled, identify, issueSession, readSession } from '../server/accounts.ts'
import { handleScoreRequest } from '../shared/scoreHandler.ts'
import type { Accounts, ScoreStore, Stored as ScoreStored } from '../shared/scoreHandler.ts'
import type { ScoreDoc, ScoreReq } from '../shared/scores.ts'

const ROOM_ROUTE = '/api/room'
const GATE_ROUTE = '/api/gate'
const SCORE_ROUTE = '/api/scores'

/**
 * In-memory stand-in for the leaderboard blob, exercising the same
 * compare-and-swap path the deployed function uses.
 */
function memoryScores(): ScoreStore {
  let held: { doc: ScoreDoc; version: number } | null = null
  let counter = 0

  return {
    async read(): Promise<ScoreStored | null> {
      if (!held) return null
      return { doc: structuredClone(held.doc), version: String(held.version) }
    },
    async write(doc, prev): Promise<boolean> {
      if (prev?.version) {
        if (!held || String(held.version) !== prev.version) return false
      } else if (held) {
        return false
      }
      held = { doc: structuredClone(doc), version: ++counter }
      return true
    },
  }
}

const devAccounts: Accounts = {
  identify,
  issue: issueSession,
  read: readSession,
  enabled: accountsEnabled,
}

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
  const scores = memoryScores()

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (url !== ROOM_ROUTE && url !== GATE_ROUTE && url !== SCORE_ROUTE) return next()

    const send = (payload: unknown, status: number) => {
      const text = JSON.stringify(payload)
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(text)
    }

    // Mirrors netlify/functions/gate.ts. Set ARCADE_PLAYER_KEYS (and optionally
    // ARCADE_KEY) before `npm run dev` to exercise the login locally; unset,
    // the app opens straight into the games.
    if (url === GATE_ROUTE) {
      if (req.method !== 'GET') return send({ ok: false, error: 'BAD_REQUEST' }, 405)
      return send({ required: loginRequired() }, 200)
    }

    if (req.method !== 'POST') return send({ ok: false, error: 'BAD_REQUEST' }, 405)

    // Rooms need a session; scores are how you get one, so they authenticate
    // per-op inside the handler instead.
    if (url === ROOM_ROUTE && !authorised(req.headers['x-arcade-token'] as string | undefined)) {
      return send({ ok: false, error: 'LOCKED' }, 401)
    }

    if (url === SCORE_ROUTE) {
      try {
        const body = JSON.parse(await readBody(req)) as ScoreReq
        const result = await handleScoreRequest(scores, devAccounts, body)
        return send(result, result.ok ? 200 : 400)
      } catch (error) {
        console.error('[dev scores]', error)
        return send({ ok: false, error: 'BAD_REQUEST' }, 400)
      }
    }

    try {
      const body = JSON.parse(await readBody(req)) as RoomReq
      const result = await handleRoomRequest(store, body, Date.now(), DEFAULT_HOLD)
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
