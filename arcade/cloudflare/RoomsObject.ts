import { DurableObject } from 'cloudflare:workers'
import type { RoomReq } from '../shared/protocol.ts'
import { DEFAULT_HOLD, handleRoomRequest } from '../shared/roomHandler.ts'
import type { RoomDoc, RoomStore, Stored } from '../shared/roomHandler.ts'

/**
 * Every room, in one Durable Object.
 *
 * This is the whole reason for moving off Netlify. The old server could only
 * *notice* an opponent's move by re-reading a blob store on a timer, so a held
 * request cost a read every 70ms and still answered up to 70ms late — and when
 * the platform declined to hold the request at all, the client fell back to
 * polling on a 220ms timer over a 275ms round trip. That is where the second of
 * lag in Tug came from.
 *
 * A Durable Object is single-threaded and owns its state in memory, so a write
 * can hand the waiting request its answer directly. `sleep` below is the entire
 * trick: the handler's poll loop is unchanged, but its sleep resolves the
 * instant somebody writes rather than when a timer expires. Polling becomes
 * push with no change to the logic that was already tested.
 *
 * One object for all rooms rather than one per room, because `create` invents
 * its own code and routing by code would mean generating it a layer up. Rooms
 * are a handful of keys in one object's storage; requests interleave at every
 * await, so a parked request never blocks anyone else. If this ever hosted more
 * than a group of friends, one object per code is the change to make.
 */
export class RoomsObject extends DurableObject {
  private docs = new Map<string, RoomDoc>()
  private versions = new Map<string, number>()
  private loaded = false
  private counter = 0

  /** Whoever is parked on each room, waiting for it to change. */
  private waiting = new Map<string, Array<() => void>>()

  private async load(): Promise<void> {
    if (this.loaded) return
    const all = await this.ctx.storage.list<RoomDoc>({ prefix: 'room:' })
    for (const [key, doc] of all) this.docs.set(key.slice(5), doc)
    this.loaded = true
  }

  /** Release everyone parked on this room; their loop re-reads and answers. */
  private wake(code: string): void {
    const parked = this.waiting.get(code)
    if (!parked?.length) return
    this.waiting.delete(code)
    for (const release of parked) release()
  }

  private sleep(code: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      const parked = this.waiting.get(code)
      if (parked) parked.push(finish)
      else this.waiting.set(code, [finish])
      // Still a timer, but now only a backstop: it bounds the hold when nothing
      // happens at all, rather than setting the pace when something does.
      setTimeout(finish, ms)
    })
  }

  private store(): RoomStore {
    return {
      read: async (code): Promise<Stored | null> => {
        await this.load()
        const doc = this.docs.get(code)
        return doc ? { doc, version: String(this.versions.get(code) ?? 0) } : null
      },

      write: async (code, doc, prev): Promise<boolean> => {
        await this.load()
        // Compare-and-swap is not strictly needed inside a single-threaded
        // object, but keeping it means this store behaves exactly like the Blobs
        // one and the handler's retry path stays honest rather than dead code.
        const current = this.docs.get(code)
        if (prev?.version) {
          if (String(this.versions.get(code) ?? 0) !== prev.version) return false
        } else if (current) {
          return false
        }

        this.docs.set(code, doc)
        this.versions.set(code, ++this.counter)
        await this.ctx.storage.put(`room:${code}`, doc)
        this.wake(code)
        return true
      },

      remove: async (code): Promise<void> => {
        await this.load()
        this.docs.delete(code)
        this.versions.set(code, ++this.counter)
        await this.ctx.storage.delete(`room:${code}`)
        // Wake anyone parked, or they would sit out the full hold waiting for a
        // room that has gone.
        this.wake(code)
      },
    }
  }

  override async fetch(request: Request): Promise<Response> {
    let req: RoomReq
    try {
      req = (await request.json()) as RoomReq
    } catch {
      return json({ ok: false, error: 'BAD_REQUEST', message: 'invalid JSON' }, 400)
    }

    const code = (req as { code?: string }).code ?? ''
    const res = await handleRoomRequest(this.store(), req, Date.now(), {
      ...DEFAULT_HOLD,
      sleep: (ms) => this.sleep(code, ms),
      // A backstop, not a pace: the wake-up above is what actually ends a hold
      // the instant something happens. It must stay *inside* `holdMs` — set
      // longer than the hold, the very first sleep overshoots the deadline, the
      // loop exits without ever re-reading, and every held request returns
      // stale. That looked exactly like the opponent never joining.
      pollMs: 900,
      hotPollMs: 900,
    })

    return json(res, res.ok ? 200 : 400)
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
