# Arcade

Four two-player mini games. One player makes a room, gets a four-letter code, the
other joins. No accounts, no login, no install. There is a solo mode against a bot
so the app is never a dead end.

| Game | Rule | Format |
| --- | --- | --- |
| Reaction Duel | When the screen flips colour, tap first — tap early and you lose the round. | Best of 5 |
| Shift | Tic-tac-toe where you only ever own three pieces; your fourth removes your oldest. | First to 2 |
| Dot Grab | Dots pop up on a shared board — tap to claim, most dots wins. | 30 seconds |
| Word Sprint | Same seven letters for both players, spell the most words. | 60 seconds |

React + Vite + TypeScript, Tailwind v4, Framer Motion. ~118KB gzipped for the app,
plus an 86KB dictionary chunk that only loads if someone picks Word Sprint.

---

## Run it locally

```bash
cd arcade
npm install
npm run dev          # http://localhost:5173
```

Open the site in two browser tabs to play against yourself — each tab gets its own
identity, so one can create a room and the other can join it.

```bash
npm run build        # typecheck + production build into dist/
npm run preview      # serve the built output on :4173
npm run typecheck    # tsc only
npm run gen:words    # regenerate the Word Sprint dictionary (rarely needed)
```

`npm run dev` and `npm run preview` both mount a local stand-in for the room API at
`/api/room`, backed by an in-memory Map. It runs the *same* handler the deployed
function runs, so multiplayer is fully testable locally without the Netlify CLI.

## Environment variables

**None.** There is nothing to configure and no third-party account to create.

Multiplayer runs on Netlify Blobs, which is provisioned automatically for the site
and authenticates itself from inside the function — so there are no keys, no
dashboard setup, and no SQL to run. If you were expecting Supabase credentials,
that is what replaced them; see "How multiplayer works" below.

## Deploy

> **This was not deployed from the session that built it.** Every Netlify host
> (`api.netlify.com`, `app.netlify.com`, and the upload endpoint) is blocked by
> that environment's outbound network policy, so the upload could not leave the
> container. An empty site was created via the API and is waiting for a deploy:
> **`two-minute-arcade`** — https://app.netlify.com/projects/two-minute-arcade

Either option below finishes it.

**Option A — connect the repo (recommended, gives you deploy-on-push).**
In the Netlify UI for `two-minute-arcade`: *Site configuration → Build & deploy →
Link repository*, pick this repo, and set:

- Base directory: `arcade`
- Build command: `npm run build`
- Publish directory: `arcade/dist`
- Functions directory: `arcade/netlify/functions`

`arcade/netlify.toml` already declares all of these, so the defaults it offers
should be correct.

**Option B — one command from your machine.**

```bash
cd arcade
npx netlify-cli deploy --prod --site two-minute-arcade
```

Either way, verify afterwards that `POST /api/room` returns JSON rather than the
SPA fallback — that is the one thing a misconfigured functions directory breaks.

## How multiplayer works

The server is a **sequencer, not a referee**. It never runs game logic. It stamps
each incoming event with a monotonic sequence number and appends it to a log; both
clients replay that identical log through the same pure reducer, so they converge
without the server knowing what tic-tac-toe is.

That single decision handles most of the hard cases for free:

- **Someone refreshes mid-game** — identity lives in `sessionStorage`, so the same
  tab reclaims its seat, refetches the log and replays it back to the exact state.
- **Two people join the same code** — seats are `host` and `guest`; a third
  distinct player gets `ROOM_FULL`.
- **Opponent disconnects** — presence decays on a wall clock, so a dead network is
  noticed even though no syncs are arriving. An overlay appears; if they come back,
  it disappears.
- **Latency on Reaction Duel** — each client flips its *own* screen and measures
  against its *own* flip, then reports the elapsed milliseconds. Round-trip time is
  never part of the comparison, so a slow connection is not penalised and a fast one
  gains nothing.

Transport is `POST /api/room` polling, adaptive: 220ms during a live match, 900ms in
the lobby, paused entirely when the tab is hidden. Push and poll share one round
trip. Optimistic local events are applied instantly and reconciled when the log
confirms them.

**A note on the free tier.** Two players in an active match cost roughly 9
invocations per second between them, so a 2-minute game is about 1,100 of Netlify's
125k free monthly invocations — call it 100 games a month. If you outgrow that, the
cheapest fix is raising `TEMPO_MS.active` in `src/net/types.ts`; the honest fix is
swapping in a websocket transport (see below).

Swapping the transport is contained: `src/net/types.ts` defines the `Transport`
interface, and `onlineTransport.ts` and `botTransport.ts` are the two
implementations. A Supabase Realtime version would be a third file implementing the
same six methods, with no changes to any game.

---

## Adding a fifth game

A game is a directory of four files. Nothing outside it needs to know the game
exists except one line in the registry.

```
src/games/yourgame/
├── logic.ts     state shape, init(), reduce()   ← the whole game
├── bot.ts       the solo opponent
├── View.tsx     the board
└── index.ts     ties the three together
```

**1. `logic.ts`** — extend `BaseGameState` and write a pure reducer. The shell reads
`phase`, `scores` and `winner` to drive the HUD and the result card, so you get all
of that by filling them in.

```ts
export type YourState = BaseGameState & { /* your fields */ }

export function init(ctx: GameCtx): YourState {
  return { phase: 'playing', scores: { host: 0, guest: 0 }, winner: null }
}

export function reduce(state: YourState, event: MatchEvent, ctx: GameCtx): YourState {
  if (event.type !== 'yourevent') return state
  return { ...state /* ... */ }
}
```

Two rules: `reduce` must be **pure and deterministic** — both clients run it over
the same log and must agree — and any randomness must come from `ctx.seed` via
`mulberry32` in `src/lib/random.ts`, never `Math.random()`.

**2. `bot.ts`** — a `BotFactory`. It sees the same log and writes to the same log,
so nothing else needs a solo-mode branch. `react` is called on every log change and
may be called repeatedly for the same state, so track what you have already
answered.

**3. `View.tsx`** — a component taking `{ state, ctx, clock, send }`. Call
`send('yourevent', data)` to act. Use `Press` for anything tappable so the press feel
and audio cue match the rest of the app.

**4. `index.ts`** — export a `GameModule` with `meta`, `init`, `reduce`, `bot`,
`View`. Set `meta.durationMs` for a timed game and the shell will run the countdown
and end the match for you; leave it off for a first-to-N game. Add
`prepare: () => Promise<void>` if you need to load an asset before play (Word Sprint
uses it for the dictionary).

**5. Register it** — add the id to `GameId` in `shared/protocol.ts`, then add two
lines in `src/games/registry.ts`:

```ts
export const GAMES = { /* ... */ yourgame: yourGame }
export const GAME_ORDER: GameId[] = ['reaction', 'shift', 'grab', 'sprint', 'yourgame']
```

That is all. The lobby card, ready gate, score line, timer, disconnect overlay,
result card, rematch and bot wiring are already handled.

---

## Layout

```
arcade/
├── shared/          protocol + room handler (browser, function and dev server all import this)
├── netlify/functions/room.ts    the only server endpoint, backed by Netlify Blobs
├── dev/             local stand-in for that endpoint
├── scripts/         word list generator
└── src/
    ├── net/         transports, useMatch, client-side prediction
    ├── games/       one directory per game + the registry
    ├── components/  design system and the shared game shell
    ├── screens/     home, room, picker, ready gate
    └── lib/         theme, sound, motion vocabulary, seeded RNG
```

Fonts (Bricolage Grotesque for display, Inter for UI) are self-hosted Latin subsets
in `src/fonts`, both SIL OFL — licences are alongside them.
