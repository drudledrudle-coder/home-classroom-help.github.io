import type { Slot } from '../../shared/protocol'

/**
 * A direct data channel to the other player, used as a *fast lane* — never as
 * the source of truth.
 *
 * The server stays the sequencer: it assigns `seq`, and both clients replay
 * that log. Peer-to-peer has no authority, so if this carried the real ordering
 * two simultaneous taps would order differently on each phone and the logs
 * would diverge. Instead the same event goes both ways at once, and whichever
 * arrives first is *rendered* first; the server's copy decides what actually
 * happened. That makes this a pure optimisation — if it never connects, the
 * game plays exactly as it does today, just slower.
 *
 * The win is specifically two phones on the same network: the channel connects
 * on host candidates and the packet never leaves the building. Across the
 * internet STUN usually still finds a path, and where it does not (symmetric
 * NAT, some mobile carriers) there is no TURN to fall back on — relays cost
 * money and this has none — so those sessions simply stay on the server path.
 */

const STUN: RTCIceServer[] = [
  // Public STUN only. It reveals a candidate address to the other player, who
  // is someone you handed a room code to, and carries no traffic itself.
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

/** Give up and stay on the server path rather than retrying for ever. */
const CONNECT_TIMEOUT_MS = 12_000

/**
 * `id` present: the fast-lane copy of a real event, which the server is also
 * carrying and will order. Absent: an ephemeral hint that exists only on this
 * channel — no log entry, no sequencing, no authority.
 */
export type PeerMessage = { id?: string; type: string; data?: unknown }

export type PeerApi = {
  /** True once the channel is open and usable. */
  ready: () => boolean
  send: (message: PeerMessage) => void
  /** Feed in signalling that arrived from the room API. */
  accept: (raw: string) => void
  close: () => void
}

export function createPeer(opts: {
  /** The host offers; exactly one side must, or both stall waiting. */
  slot: Slot
  sendSignal: (raw: string) => void
  onMessage: (message: PeerMessage) => void
  onOpen: () => void
  onClosed: () => void
}): PeerApi | null {
  if (typeof RTCPeerConnection === 'undefined') return null

  const initiator = opts.slot === 'host'
  const pc = new RTCPeerConnection({ iceServers: STUN })
  let channel: RTCDataChannel | null = null
  let open = false
  let dead = false

  const signal = (payload: unknown) => {
    try {
      opts.sendSignal(JSON.stringify(payload))
    } catch {
      /* nothing useful to do; the server path still works */
    }
  }

  const bind = (dc: RTCDataChannel) => {
    channel = dc
    dc.onopen = () => {
      open = true
      opts.onOpen()
    }
    dc.onclose = () => {
      open = false
      opts.onClosed()
    }
    dc.onmessage = (e) => {
      try {
        opts.onMessage(JSON.parse(e.data as string) as PeerMessage)
      } catch {
        /* a malformed frame is ignored, never thrown into the game loop */
      }
    }
  }

  if (initiator) {
    // Unordered and unreliable on purpose. This is a fast lane for something
    // the server will deliver anyway, so a dropped frame costs nothing and
    // waiting to retransmit it would defeat the point.
    bind(pc.createDataChannel('arcade', { ordered: false, maxRetransmits: 0 }))
  } else {
    pc.ondatachannel = (e) => bind(e.channel)
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) signal({ kind: 'ice', candidate: e.candidate.toJSON() })
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      open = false
      opts.onClosed()
    }
  }

  const negotiate = async () => {
    if (!initiator) return
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      signal({ kind: 'sdp', sdp: pc.localDescription })
    } catch {
      /* stays on the server path */
    }
  }
  void negotiate()

  // Queued until the remote description exists — a candidate applied too early
  // throws, and browsers do deliver them out of order.
  const pendingIce: RTCIceCandidateInit[] = []
  const drainIce = async () => {
    while (pendingIce.length) {
      const c = pendingIce.shift()!
      try {
        await pc.addIceCandidate(c)
      } catch {
        /* a stale candidate is not fatal */
      }
    }
  }

  const timer = setTimeout(() => {
    if (!open) close()
  }, CONNECT_TIMEOUT_MS)

  function close() {
    if (dead) return
    dead = true
    clearTimeout(timer)
    open = false
    try {
      channel?.close()
      pc.close()
    } catch {
      /* already gone */
    }
  }

  return {
    ready: () => open && !dead,

    send(message) {
      if (!open || !channel || channel.readyState !== 'open') return
      try {
        channel.send(JSON.stringify(message))
      } catch {
        /* the server copy is already on its way regardless */
      }
    },

    accept(raw) {
      if (dead) return
      void (async () => {
        try {
          const msg = JSON.parse(raw) as
            | { kind: 'sdp'; sdp: RTCSessionDescriptionInit }
            | { kind: 'ice'; candidate: RTCIceCandidateInit }

          if (msg.kind === 'ice') {
            if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate)
            else pendingIce.push(msg.candidate)
            return
          }

          if (msg.kind !== 'sdp' || !msg.sdp) return
          await pc.setRemoteDescription(msg.sdp)
          await drainIce()

          if (msg.sdp.type === 'offer') {
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            signal({ kind: 'sdp', sdp: pc.localDescription })
          }
        } catch {
          /* a failed handshake just means no fast lane */
        }
      })()
    },

    close,
  }
}
