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

React + Vite + TypeScript, Tailwind v4, Framer Motion. ~120KB gzipped for the app,
plus an 86KB dictionary chunk that only loads if someone picks Word Sprint.

---

## The access key

The site is private. Visitors get a key screen before they can reach anything.

> **The key itself is deliberately not written down here — this repository is
> public.** To read the current value: Netlify → **two-minute-arcade** → Site
> configuration → Environment variables → `ARCADE_KEY`. It is stored unhidden so
> you can always look it up. Never paste it into a file in this repo.

The key lives in the `ARCADE_KEY` environment variable on Netlify and is only ever
compared inside a serverless function. It is never sent to the browser and never
appears in the built JavaScript, so it cannot be read out of page source. It also
guards the room API itself, not just the entry screen — otherwise it would be
decoration, since rooms could still be driven directly.

### Changing it

1. Netlify → **two-minute-arcade** → Site configuration → Environment variables
2. Edit `ARCADE_KEY`, save
3. Deploys → **Trigger deploy** → Deploy site

Step 3 is required: functions read environment variables from the deploy they
shipped with, so a new value does nothing until the site redeploys. Takes about a
minute.

Two things worth knowing:

- **Changing the key signs everyone out.** Unlock tokens are signed with the key
  itself, so old ones stop verifying the moment it changes. That is the behaviour
  you want from a shared password, but it does mean anyone mid-game gets bounced.
- **Deleting `ARCADE_KEY` makes the site public.** The gate disables itself when
  the variable is unset, so a missing value degrades to "open" rather than locking
  you out of your own site. Delete it deliberately, not by accident.

A wrong guess costs the guesser about half a second, which makes brute-forcing a
multi-word key impractical, but this is a door on a party game — not a vault. Pick
something longer than a word or two, and keep it out of this repository, which is
public.

To exercise the key screen locally: `ARCADE_KEY=whatever npm run dev`.

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

`npm run dev` and `npm run preview` both mount a local stand-in for the server at
`/api/room` and `/api/gate`, backed by an in-memory Map. It runs the *same* handler
the deployed functions run, so multiplayer and the key are fully testable locally
without the Netlify CLI.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `ARCADE_KEY` | No | The site access key. Unset means no key screen. See above. |

That is the entire list. Multiplayer runs on Netlify Blobs, which is provisioned
automatically and authenticates itself from inside the function — no keys, no
dashboard setup, no SQL.

## Deploy

The site is **two-minute-arcade** → https://app.netlify.com/projects/two-minute-arcade

It is wired for deploy-on-push. In the Netlify UI: Site configuration → Build &
deploy → Link repository, pick this repo, and confirm:

- Base directory: `arcade`
- Build command: `npm run build`
- Publish directory: `arcade/dist`
- Functions directory: `arcade/netlify/functions`

`arcade/netlify.toml` already declares all of these, so the values Netlify offers
should already be right. After linking, every push deploys itself.

After the first deploy, check that `POST /api/room` returns JSON rather than the
SPA fallback — a misconfigured functions directory is the one thing that breaks
silently.

## Devices

Built mobile-first and checked at nine viewports — 375/390 phone portrait, phone
landscape, iPad mini/Air/Pro portrait, iPad landscape, 1440 laptop and 1920 desktop
— in both themes, with no horizontal overflow, no clipped playfield and no touch
target under 44px.

Two cases needed real work rather than a breakpoint. Shift's board is square, so on
a phone in landscape its *height* runs out first — bounding it only by width would
render it 512px tall inside 230px of space and clip it, so its width is also capped
against the leftover viewport height. And a `short` variant (`max-height: 560px`)
compresses the chrome when a phone is held sideways, since that is a height problem
and normal breakpoints only see width.

Cursor-driven motion — the trailing light, the magnetic buttons, the rule that
slides between index rows — is gated behind `(pointer: fine)` and switched off
entirely for `prefers-reduced-motion`. Nothing needed to play is ever behind a
hover.

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

Two subtleties that are easy to get wrong, both marked in the code:

- A transport only sends `leave` if it actually joined. A join-mode transport knows
  its room code before it has joined anything, and since the player id is stable
  across reloads, a premature `leave` evicts whichever session legitimately holds
  that seat.
- There is no `pagehide` teardown, for the same reason: releasing the seat on unload
  races the reloaded page's rejoin. Presence expiry covers a real tab close.

Transport is `POST /api/room` polling, adaptive: 220ms during a live match, 900ms in
the lobby, paused when the tab is hidden. Push and poll share one round trip.
Optimistic local events are applied instantly and reconciled when the log confirms
them.

**A note on the free tier.** Two players in an active match cost roughly 9
invocations per second between them, so a 2-minute game is about 1,100 of Netlify's
125k free monthly invocations — call it 100 games a month. If you outgrow that, the
cheapest fix is raising `TEMPO_MS.active` in `src/net/types.ts`; the honest fix is
swapping in a websocket transport. That swap is contained: `src/net/types.ts` defines
the `Transport` interface, and `onlineTransport.ts` and `botTransport.ts` are the two
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

That is all. The lobby row, ready gate, score line, timer, disconnect overlay,
result card, rematch and bot wiring are already handled.

---

## Layout

```
arcade/
├── shared/          protocol + room handler (browser, functions and dev server all import this)
├── server/          site-key signing and verification (functions only)
├── netlify/functions/
│   ├── room.ts      the room sequencer, backed by Netlify Blobs
│   └── gate.ts      the key check
├── dev/             local stand-in for both endpoints
├── scripts/         word list generator
└── src/
    ├── net/         transports, useMatch, client-side prediction, gate client
    ├── games/       one directory per game + the registry
    ├── components/  design system and the shared game shell
    ├── screens/     gate, home, room, picker, ready gate
    └── lib/         theme, sound, motion vocabulary, pointer detection, seeded RNG
```

Fonts (Bricolage Grotesque for display, Inter for UI) are self-hosted Latin subsets
in `src/fonts`, both SIL OFL — licences are alongside them.
