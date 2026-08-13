import { PARTY_GAMES } from '../games/party/registry'
import type { PartyId } from '../games/party/types'
import { TopBar } from '../components/TopBar'

/**
 * Party games own their entire flow, so this is only the chrome around them —
 * there is no score to keep and no opponent to wait for.
 */
export function PartyPlay({ id, onExit }: { id: PartyId; onExit: () => void }) {
  const module = PARTY_GAMES[id]
  const Play = module.Play

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <TopBar onBack={onExit} center={<Title text={module.meta.title} />} />
      <div className="flex min-h-0 flex-1 flex-col">
        <Play onExit={onExit} />
      </div>
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
