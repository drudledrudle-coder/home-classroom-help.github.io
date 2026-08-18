import { DurableObject } from 'cloudflare:workers'
import { accountsEnabled, identify, issueSession, readSession } from '../server/accounts.ts'
import { bridgeEnv } from './env.ts'
import type { ArcadeEnv } from './env.ts'
import { handleScoreRequest } from '../shared/scoreHandler.ts'
import type { Accounts, ScoreStore, Stored } from '../shared/scoreHandler.ts'
import type { ScoreDoc, ScoreReq } from '../shared/scores.ts'

/**
 * The leaderboard, in one Durable Object.
 *
 * A natural fit for a single object: it *is* a single document, every request
 * reads the whole of it, and two people finishing a run in the same instant is
 * exactly the race a single-threaded owner removes for free.
 */
export class ScoresObject extends DurableObject<ArcadeEnv> {
  private doc: ScoreDoc | null = null
  private version = 0
  private loaded = false

  private async load(): Promise<void> {
    if (this.loaded) return
    this.doc = (await this.ctx.storage.get<ScoreDoc>('board')) ?? null
    this.loaded = true
  }

  private store(): ScoreStore {
    return {
      read: async (): Promise<Stored | null> => {
        await this.load()
        return this.doc ? { doc: this.doc, version: String(this.version) } : null
      },

      write: async (doc, prev): Promise<boolean> => {
        await this.load()
        if (prev?.version) {
          if (String(this.version) !== prev.version) return false
        } else if (this.doc) {
          return false
        }
        this.doc = doc
        this.version += 1
        await this.ctx.storage.put('board', doc)
        return true
      },
    }
  }

  override async fetch(request: Request): Promise<Response> {
    // Not redundant with the Worker's call. This object is a separate isolate
    // with its own `process`, so without this every key lookup below comes back
    // empty and the app reports that no accounts are configured.
    bridgeEnv(this.env)

    let req: ScoreReq
    try {
      req = (await request.json()) as ScoreReq
    } catch {
      return json({ ok: false, error: 'BAD_REQUEST', message: 'invalid JSON' }, 400)
    }

    const accounts: Accounts = {
      identify,
      issue: issueSession,
      read: readSession,
      enabled: accountsEnabled,
    }

    const res = await handleScoreRequest(this.store(), accounts, req)
    return json(res, res.ok ? 200 : 400)
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
