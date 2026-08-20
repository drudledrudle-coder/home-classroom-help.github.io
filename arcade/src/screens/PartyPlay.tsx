import { useState } from 'react'
import { PARTY_GAMES } from '../games/party/registry'
import type { PartyId } from '../games/party/types'
import { GameMenu } from '../components/GameMenu'
import { TopBar } from '../components/TopBar'

/**
 * Party games own their entire flow, so this is only the chrome around them —
 * there is no score to keep and no opponent to wait for.
 *
 * Leaving still confirms. Nobody's clock is running, but a party game is played
 * by a table of people around one phone, and backing out of Imposter halfway
 * ends the round for all of them rather than just the person holding it.
 */
export function PartyPlay({ id, onExit }: { id: PartyId; onExit: () => void }) {
  const module = PARTY_GAMES[id]
  const Play = module.Play
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative flex min-h-[100dvh] flex-col">
      <TopBar
        onBack={() => setMenuOpen(true)}
        onPause={() => setMenuOpen(true)}
        center={<Title text={module.meta.title} />}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <Play onExit={onExit} />
      </div>

      <GameMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Paused"
        note="Nothing is running — the phone waits for whoever has it."
        leave={{
          label: 'End the game',
          confirmLabel: 'End it for everyone',
          warning: 'Everyone playing goes back to the menu, mid-round.',
          onLeave: onExit,
        }}
      />
    </div>
  )
}

function Title({ text }: { text: string }) {
  return (
    <span className="chrome rounded-lg border border-line bg-surface px-2.5 py-1.5 text-muted">
      {text}
    </span>
  )
}
