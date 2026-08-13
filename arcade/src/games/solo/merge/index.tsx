import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import { springSnap, springSoft } from '../../../lib/motion'
import { useDirectionInput } from '../../../lib/input'
import type { Dir } from '../../../lib/input'
import { useSound } from '../../../lib/sound'
import type { SoloApi, SoloModule } from '../types'

const SIZE = 4

type Tile = { id: number; value: number; row: number; col: number }

let nextId = 1

function emptyCells(tiles: Tile[]): Array<[number, number]> {
  const taken = new Set(tiles.map((t) => t.row * SIZE + t.col))
  const out: Array<[number, number]> = []
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) if (!taken.has(r * SIZE + c)) out.push([r, c])
  return out
}

function spawn(tiles: Tile[]): Tile[] {
  const open = emptyCells(tiles)
  if (!open.length) return tiles
  const [row, col] = open[Math.floor(Math.random() * open.length)]
  return [...tiles, { id: nextId++, value: Math.random() < 0.9 ? 2 : 4, row, col }]
}

/** One line of the board, ordered along the direction of travel. */
function lineOf(tiles: Tile[], index: number, dir: Dir): Tile[] {
  const line = tiles.filter((t) => (dir === 'left' || dir === 'right' ? t.row : t.col) === index)
  const along = (t: Tile) => (dir === 'left' || dir === 'right' ? t.col : t.row)
  line.sort((a, b) => (dir === 'right' || dir === 'down' ? along(b) - along(a) : along(a) - along(b)))
  return line
}

type Move = { tiles: Tile[]; gained: number; moved: boolean }

/**
 * Slides every line towards `dir`, merging equal neighbours once each. Merged
 * tiles keep the id of the tile that survives, so the view can animate the
 * loser sliding into it rather than both blinking out.
 */
function slide(tiles: Tile[], dir: Dir): Move {
  const result: Tile[] = []
  let gained = 0
  let moved = false

  for (let i = 0; i < SIZE; i++) {
    const line = lineOf(tiles, i, dir)
    const packed: Tile[] = []

    for (const tile of line) {
      const last = packed[packed.length - 1]
      if (last && last.value === tile.value && !(last as Tile & { merged?: boolean }).merged) {
        last.value *= 2
        ;(last as Tile & { merged?: boolean }).merged = true
        gained += last.value
        moved = true
        continue
      }
      packed.push({ ...tile })
    }

    packed.forEach((tile, slot) => {
      const pos = dir === 'right' || dir === 'down' ? SIZE - 1 - slot : slot
      const row = dir === 'left' || dir === 'right' ? i : pos
      const col = dir === 'left' || dir === 'right' ? pos : i
      if (tile.row !== row || tile.col !== col) moved = true
      result.push({ id: tile.id, value: tile.value, row, col })
    })
  }

  return { tiles: result, gained, moved }
}

function canMove(tiles: Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true
  return (['up', 'down', 'left', 'right'] as Dir[]).some((d) => slide(tiles, d).moved)
}

/** Higher tiles sit heavier in the accent; the board reads as a gradient of one colour. */
function tileStyle(value: number): { background: string; color: string } {
  const step = Math.min(11, Math.log2(value))
  const mix = 8 + step * 8.5
  return {
    background: `color-mix(in srgb, var(--t-accent) ${mix}%, var(--t-surface))`,
    color: mix > 55 ? 'var(--t-accent-ink)' : 'var(--t-ink)',
  }
}

function MergePlay({ api }: { api: SoloApi }) {
  const sound = useSound()
  const [tiles, setTiles] = useState<Tile[]>(() => spawn(spawn([])))
  const score = useRef(0)
  const dead = useRef(false)

  // Read through a ref rather than a functional updater: scoring and ending the
  // run are side effects, and a state updater must stay pure — doing it inside
  // one makes React warn about updating another component mid-render.
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  const move = useCallback(
    (dir: Dir) => {
      if (dead.current) return
      const next = slide(tilesRef.current, dir)
      if (!next.moved) return

      if (next.gained) {
        score.current += next.gained
        api.setScore(score.current)
        sound.play('pop')
      } else {
        sound.play('tap')
      }

      const grown = spawn(next.tiles)
      setTiles(grown)

      if (!canMove(grown)) {
        dead.current = true
        // Let the final tile land before the result card covers the board.
        setTimeout(() => api.end(), 420)
      }
    },
    [api, sound],
  )

  useDirectionInput(move, true)

  const highest = tiles.reduce((max, t) => Math.max(max, t.value), 0)

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-3 sm:px-6">
      <div className="flex items-baseline justify-between pb-3">
        <span className="chrome text-muted">Highest {highest}</span>
        <span className="chrome text-muted/60">Swipe or arrows</span>
      </div>

      <div
        className="relative aspect-square w-full rounded-2xl border border-line bg-surface p-2"
        style={{ maxWidth: 'min(100%, calc(100dvh - 16rem))' }}
      >
        {/* Empty wells, so the grid reads even when nearly empty. */}
        <div className="grid h-full w-full grid-cols-4 gap-2">
          {Array.from({ length: SIZE * SIZE }, (_, i) => (
            <div key={i} className="rounded-lg bg-bg/60" />
          ))}
        </div>

        <div className="absolute inset-2">
          <AnimatePresence>
            {tiles.map((tile) => (
              <motion.div
                key={tile.id}
                initial={{ scale: 0.3, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  left: `calc(${tile.col} * (25% + 0.125rem))`,
                  top: `calc(${tile.row} * (25% + 0.125rem))`,
                }}
                exit={{ scale: 0.3, opacity: 0 }}
                transition={springSnap}
                className="absolute grid place-items-center rounded-lg"
                style={{
                  width: 'calc(25% - 0.375rem)',
                  height: 'calc(25% - 0.375rem)',
                  ...tileStyle(tile.value),
                }}
              >
                <motion.span
                  key={tile.value}
                  initial={{ scale: 0.7 }}
                  animate={{ scale: 1 }}
                  transition={springSoft}
                  className="display tabular-nums"
                  style={{ fontSize: tile.value > 999 ? '1.125rem' : '1.5rem' }}
                >
                  {tile.value}
                </motion.span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <p className="pt-4 text-center text-[0.8125rem] text-muted short:hidden">
        Swipe to slide everything. Equal tiles merge.
      </p>
    </div>
  )
}

export const mergeGame: SoloModule = {
  meta: {
    id: 'merge',
    title: 'Merge',
    rule: 'Swipe to slide every tile; equal tiles fuse into one worth double.',
    direction: 'high',
    unit: 'points',
  },
  Play: MergePlay,
}
