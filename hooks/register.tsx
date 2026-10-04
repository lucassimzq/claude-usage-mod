import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Activity, Game, Gauges, Limit, Progress, Snapshot } from '../types'

const gauges = atom({ plugin: 'usage-hud', key: 'gauges' } as const, { cur: null, prev: null })
const isHidden = atom({ plugin: 'usage-hud', key: 'isHidden' } as const, false)
const activity = atom({ plugin: 'usage-hud', key: 'activity' } as const, 'idle')
const game = atom({ plugin: 'usage-hud', key: 'game' } as const, { progress: null, burst: false })

// #region drawing: pure, no $; scripts/render-docs.ts renders the README images from it
const SWEEP_MS = 1400
const WARN_AT = [50, 80, 95]

// Short tags keep the band quiet; the hover tooltip carries the words.
const TAGS: Record<string, { tag: string; name: string; windowMs?: number }> = {
  five_hour: { tag: '5h', name: 'Session', windowMs: 5 * 3600_000 },
  seven_day: { tag: '7d', name: 'Weekly', windowMs: 7 * 86400_000 },
  spend_limit: { tag: '$', name: 'Spend' },
}

function snapshotOf(u: {
  context: SessionContextUsage
  rateLimits: SessionRateLimit[]
  cost?: SessionCost
}): Snapshot {
  return {
    ctxPct: u.context.percent ?? 0,
    ctxTokens: u.context.tokens,
    ctxWindow: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })),
    usd: u.cost?.usd,
  }
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return `${n}`
}

function untilReset(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

type Tone = 'ok' | 'warn' | 'hot'

function tone(pct: number): Tone {
  return pct >= 80 ? 'hot' : pct >= 50 ? 'warn' : 'ok'
}

type Tank = {
  tag: string
  pct: number
  from: number
  /** How far through its window the clock is, 0 to 1: the pace mark. */
  elapsed?: number
  /** What the note calls it: `context window`, `weekly limit`. */
  name: string
  /** Time until the window resets, as `2d 4h`; absent for the context window. */
  resetIn?: string
  /** A figure from an earlier session, waiting for this one's first response. */
  isSaved?: boolean
  tip: string
}

function tanksOf(cur: Snapshot, prev: Snapshot | null, now: number): Tank[] {
  const used = cur.ctxTokens === undefined ? '' : `${tokens(cur.ctxTokens)} / `
  const list: Tank[] = [
    {
      tag: 'ctx',
      pct: cur.ctxPct,
      from: prev?.ctxPct ?? 0,
      name: 'context window',
      tip: `Context window · ${used}${tokens(cur.ctxWindow)} tokens`,
    },
  ]
  for (const l of cur.limits) {
    const meta = TAGS[l.kind] ?? { tag: l.kind.slice(0, 2), name: l.kind }
    const left = l.resetsAt ? Date.parse(l.resetsAt) - now : undefined
    const elapsed =
      left !== undefined && meta.windowMs ? Math.min(1, Math.max(0, 1 - left / meta.windowMs)) : undefined
    const ahead = elapsed !== undefined && l.pct / 100 > elapsed + 0.05
    list.push({
      tag: meta.tag,
      pct: l.pct,
      from: prev?.limits.find(p => p.kind === l.kind)?.pct ?? 0,
      elapsed,
      name: `${meta.name.toLowerCase()} limit`,
      resetIn: left === undefined ? undefined : untilReset(left),
      isSaved: l.isSaved,
      tip:
        `${meta.name} limit · ${l.pct}% used` +
        (left !== undefined ? ` · resets in ${untilReset(left)}` : '') +
        (ahead ? ' · burning faster than the clock' : ''),
    })
  }
  return list
}

const HEIGHT = 24
const P = 2 // one Clawd pixel
const FP = 1.8 // one font pixel
const CW = 4 // bar cell width
const GAP = 1
const BY = 8 // bar top
const BH = 8 // bar height
const SPRITE_W = 56
const TAG_W = 26
const PCT_W = 36
const USD_W = 46
const PX_PER_COLUMN = 7.8 // the desktop counts the band in code-font cells
const REFRESH_W = 30 // room kept at the right for the refresh button
const CLAWD = '#D97757'
const INK = '#1b1b1b'
const MUTED = '#8b9099'

const TONES: Record<Tone, string> = {
  ok: '#6b9e7a',
  warn: '#c4a05a',
  hot: '#c06565',
}

type Mood = 'happy' | 'anxious' | 'frantic' | 'panic' | 'asleep'

function moodOf(pct: number): Mood {
  return pct >= 100 ? 'asleep' : pct >= 95 ? 'panic' : pct >= 80 ? 'frantic' : pct >= 50 ? 'anxious' : 'happy'
}

const n2 = (n: number) => Math.round(n * 100) / 100

/** One path of `p`-sized squares, one per `ch` in the grid. */
function pixels(grid: string[], ox: number, oy: number, p: number, ch = '#'): string {
  let d = ''
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ch) d += `M${n2(ox + x * p)} ${n2(oy + y * p)}h${p}v${p}h-${p}z`
    }
  })
  return d
}

const rect = (x: number, y: number, w: number, h: number) => `M${n2(x)} ${n2(y)}h${w}v${h}h-${w}z`

// A 3x5 pixel font, just the glyphs the band prints.
const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '.': ['...', '...', '...', '...', '.#.'],
  c: ['...', '###', '#..', '#..', '###'],
  t: ['.#.', '###', '.#.', '.#.', '.##'],
  x: ['...', '#.#', '.#.', '.#.', '#.#'],
  h: ['#..', '#..', '###', '#.#', '#.#'],
  d: ['..#', '..#', '###', '#.#', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  v: ['...', '#.#', '#.#', '#.#', '.#.'],
}

function textPixels(s: string, x: number, y: number): string {
  return [...s].map((ch, i) => pixels(FONT[ch] ?? [], x + i * 4 * FP, y, FP)).join('')
}

const textWidth = (s: string) => (s.length * 4 - 1) * FP

// Clawd, 13 pixels wide: a 9-wide body, arms either side, four legs. Row 0 is the top
// of his head; props drawn above it (the headphone band) use negative rows.
const BODY = Array.from({ length: 7 }, () => '..#########..')
const ARMS_MID = ['', '', '', '##.........##', '##.........##']
const ARMS_LOW = ['', '', '', '', '', '##.........##', '##.........##']
const LEGS = ['', '', '', '', '', '', '', '...#.#.#.#...', '...#.#.#.#...']
const LEGS_TAPPING = ['', '', '', '', '', '', '', '...#.#.#.#...', '...#.#.#.....']
const TAP_FOOT = ['', '', '', '', '', '', '', '', '.........#...']
const BLUSH = ['', '', '', '', '...#.....#...']

// Typing: the arms take turns on the laptop's edge.
const TYPE_A = ['', '', '', '...........##', '##.........##', '##...........']
const TYPE_B = ['', '', '', '##...........', '##.........##', '...........##']
// The back of the lid, the Claude mark on it, and the base underneath.
const LAPTOP = ['', '', '', '', '', '...#######...', '...###o###...', '...#######...', '.ddddddddddd.']

// Rows -1 to 2: a band over the head and a cup on each side.
const HEADPHONES = ['...bbbbbbb...', '..b.......b..', '.cc.......cc.', '.cc.......cc.']

const EYES: Record<Mood, [string[], string[]]> = {
  happy: [['.#.', '#.#', '...'], ['.#.', '#.#', '...']],
  anxious: [['.#.', '.#.', '...'], ['.#.', '.#.', '...']],
  frantic: [['#..', '.##', '.##'], ['..#', '##.', '##.']],
  panic: [['###', '#.#', '###'], ['###', '#.#', '###']],
  asleep: [['...', '###', '...'], ['...', '###', '...']],
}
const CLOSED = ['', '', '...###.###...']

function eyesOf(mood: Mood): string[] {
  const [l, r] = EYES[mood]
  return ['', ...l.map((row, y) => `...${row}.${r[y]}...`)]
}

// A mug held in the right hand: coffee on top, the handle against the hand.
const MUG = ['.ccc', 'wwww', '.www']
const STEAM_A = ['..#.', '.#..']
const STEAM_B = ['.#..', '..#.']
const NOTE = ['..##', '..#.', '..#.', '###.', '##..']
const DROP = ['.#.', '###', '###', '.#.']
// A thought bubble with a clock in it; the hand points up, right, down, left in turn.
const BUBBLE = ['.#########.', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '.#########.']
const CLOCK = ['..###..', '.#...#.', '#.....#', '#..#..#', '#.....#', '.#...#.', '..###..']
const HANDS = [['', '...#', '...#'], ['', '', '', '....##'], ['', '', '', '', '...#', '...#'], ['', '', '', '.##']]
const FLAME_A = ['..r.', '.rr.', 'ryyr', '.yy.']
const FLAME_B = ['.r..', '.rr.', 'ryyr', '.yy.']
const ZED = ['#####', '...#.', '..#..', '.#...', '#####']
// A thought bubble with three dots lighting up in turn, while Claude thinks.
const THOUGHT = ['.#########.', '#.........#', '#.........#', '#.........#', '#.........#', '#.........#', '.#########.']
const THOUGHT_DOTS = [['', '', '', '...#'], ['', '', '', '.....#'], ['', '', '', '.......#']]

// What Clawd can wear, unlocked by level. Hats start two rows above his head (the most
// the band's height leaves), so they're drawn from row -2.
const SCARF = ['', '', '', '', '', '..#########..', '.......##....']
const BEANIE = ['....#####....', '...#######...', '..ddddddddd..']
const SHADES = ['', '..#########..', '...###.###...']
const SHADES_UP = ['...###.###...'] // pushed up onto his head when things get tense
const HARD_HAT = ['....#####....', '...###y###...', '.###########.']
const CAPE = ['', '.#.........#.', '.#.........#.', '', '', '##.........##', '##.........##', '##.........##', '#...........#']
const WIZARD_HAT = ['.......##....', '.....###y....', '..#########..']
const SPARKLE = ['.#.', '###', '.#.']

const COLORS = {
  band: '#9aa0a8',
  cups: '#8f7fc9',
  laptop: '#7d828a',
  base: '#5f646b',
  logo: '#f0a07f',
  mug: '#d8d0c4',
  coffee: '#8a5a3c',
  steam: '#a8a8a8',
  note: '#a99be0',
  drop: '#86a8c4',
  clock: '#c4a05a',
  flameOut: '#c06565',
  flameIn: '#c4a05a',
  zed: '#9aa6c4',
  sleepy: '#b9775f',
  scarf: '#7a9cc6',
  beanie: '#8f7fc9',
  beanieBrim: '#6f61a8',
  hardHat: '#d1ad55',
  shine: '#ecd27a',
  cape: '#b05f5f',
  wizard: '#7d6bc4',
  golden: '#d9b25a',
  level: '#a99be0',
}

// Each mood is a small scene, not a dance: Clawd holds still and one prop moves, slowly.
function clawdSvg(mood: Mood, doing: Activity, wear?: string, burst = false): string {
  const path = (d: string, fill: string, extra = '') => (d ? `<path d="${d}" fill="${fill}"${extra}/>` : '')
  const grid = (g: string[], fill: string, ch = '#', ox = 0, oy = 0, p = P) => path(pixels(g, ox, oy, p, ch), fill)
  const toggle = (dur: string, first: boolean) =>
    `<animate attributeName="opacity" values="${first ? '1;0' : '0;1'}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
  // Something drifting up and fading: notes, Z's, a sweat drop running down.
  const drift = (inner: string, x: number, ys: number[], dur: number, begin = 0) => {
    const values = ys.map(y => `${x} ${y}`).join(';')
    const keys = ys.map((_, k) => n2(k / ys.length)).join(';')
    const fade = ys.map((_, k) => (k === ys.length - 1 ? 0 : 1)).join(';')
    return `<g transform="translate(${x} ${ys[0]})">${inner}
      <animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keys}" calcMode="discrete" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="${fade}" keyTimes="${keys}" calcMode="discrete" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/></g>`
  }

  const typing = doing === 'typing' && mood !== 'asleep'
  const thinking = doing === 'thinking' && mood !== 'asleep'
  const holdsMug = !typing && (mood === 'anxious' || mood === 'panic')
  const body = mood === 'asleep' ? COLORS.sleepy : wear === 'golden' ? COLORS.golden : CLAWD
  const fx = (holdsMug ? 16 : 13) * P + 1 // where the props on the right begin

  const legs = typing
    ? ''
    : mood === 'happy'
      ? grid(LEGS_TAPPING, body) + `<g>${grid(TAP_FOOT, body)}${toggle('1.4s', true)}</g>`
      : grid(LEGS, body)
  const arms = typing
    ? `<g>${grid(TYPE_A, body)}${toggle('0.9s', true)}</g><g opacity="0">${grid(TYPE_B, body)}${toggle('0.9s', false)}</g>`
    : grid(mood === 'asleep' ? ARMS_LOW : ARMS_MID, body)
  const eyes =
    mood === 'anxious'
      ? `<g>${grid(eyesOf(mood), INK)}<animate attributeName="opacity" values="1;0" keyTimes="0;0.94" calcMode="discrete" dur="5s" repeatCount="indefinite"/></g>` +
        `<g opacity="0">${grid(CLOSED, INK)}<animate attributeName="opacity" values="0;1" keyTimes="0;0.94" calcMode="discrete" dur="5s" repeatCount="indefinite"/></g>`
      : grid(eyesOf(mood), INK)
  const blush = mood === 'happy' ? grid(BLUSH, '#dba3ae') : ''
  const headphones = mood === 'happy' ? grid(HEADPHONES, COLORS.band, 'b', 0, -P) + grid(HEADPHONES, COLORS.cups, 'c', 0, -P) : ''
  const tense = mood === 'frantic' || mood === 'panic' || mood === 'asleep'
  const hat = -2 * P
  const outfit: Record<string, string> = {
    scarf: grid(SCARF, COLORS.scarf),
    beanie: grid(BEANIE, COLORS.beanie, '#', 0, hat) + grid(BEANIE, COLORS.beanieBrim, 'd', 0, hat),
    sunglasses: tense ? grid(SHADES_UP, INK) : grid(SHADES, INK),
    hardhat: grid(HARD_HAT, COLORS.hardHat, '#', 0, hat) + grid(HARD_HAT, COLORS.shine, 'y', 0, hat),
    wizard: grid(WIZARD_HAT, COLORS.wizard, '#', 0, hat) + grid(WIZARD_HAT, COLORS.shine, 'y', 0, hat),
  }
  const worn = (wear && outfit[wear]) || ''
  const cape = wear === 'cape' ? grid(CAPE, COLORS.cape) : ''
  // A level-up: a few sparkles blink twice around him, then stay gone.
  const sparkles = burst
    ? [[-7, 0], [27, -3], [-5, 13], [29, 13]]
        .map(([x, y]) => grid(SPARKLE, COLORS.shine, '#', x, y, 1.2))
        .map(
          (s, k) =>
            `<g opacity="0">${s}<animate attributeName="opacity" values="0;1;0;1;0" keyTimes="0;0.2;0.4;0.6;0.8" calcMode="discrete" dur="${2 + k * 0.1}s" fill="freeze"/></g>`,
        )
        .join('')
    : ''
  const laptop = typing ? grid(LAPTOP, COLORS.laptop) + grid(LAPTOP, COLORS.logo, 'o') + grid(LAPTOP, COLORS.base, 'd') : ''
  const mug = holdsMug
    ? grid(MUG, COLORS.coffee, 'c', 12 * P, 2 * P) +
      grid(MUG, COLORS.mug, 'w', 12 * P, 2 * P) +
      `<g>${grid(STEAM_A, COLORS.steam, '#', 12 * P, 0)}${toggle('1.6s', true)}</g>` +
      `<g opacity="0">${grid(STEAM_B, COLORS.steam, '#', 12 * P, 0)}${toggle('1.6s', false)}</g>`
    : ''

  const note = grid(NOTE, COLORS.note, '#', 0, 0, 1.1)
  const sweat = drift(grid(DROP, COLORS.drop, '#', 0, 0, 1.2), -4, [1, 4, 7, 10], 4)
  const flames = (x: number) =>
    `<g>${grid(FLAME_A, COLORS.flameOut, 'r', x, 12, 1.4)}${grid(FLAME_A, COLORS.flameIn, 'y', x, 12, 1.4)}${toggle('1s', true)}</g>` +
    `<g opacity="0">${grid(FLAME_B, COLORS.flameOut, 'r', x, 12, 1.4)}${grid(FLAME_B, COLORS.flameIn, 'y', x, 12, 1.4)}${toggle('1s', false)}</g>`
  // The clock's hand steps round once every four seconds.
  const bx = fx + 2
  const by = -4
  const cp = 1.1
  const clock =
    grid(['#'], MUTED, '#', fx, 6, cp) +
    grid(BUBBLE, MUTED, '#', bx, by, cp) +
    grid(CLOCK, COLORS.clock, '#', bx + 2 * cp, by + 1 * cp, cp) +
    HANDS.map(
      (h, k) =>
        `<g opacity="${k === 0 ? 1 : 0}">${grid(h, COLORS.clock, '#', bx + 2 * cp, by + 1 * cp, cp)}<animate attributeName="opacity" values="${HANDS.map((_, j) => (j === k ? 1 : 0)).join(';')}" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="4s" repeatCount="indefinite"/></g>`,
    ).join('')

  const tp = 1.1
  const thought =
    grid(['#'], MUTED, '#', fx - 1, 6, tp) +
    grid(['#'], MUTED, '#', fx + 1, 3, 1.5) +
    grid(THOUGHT, MUTED, '#', fx + 3, -5, tp) +
    path(pixels(['', '', '', '...#.#.#'], fx + 3, -5, tp), MUTED, ' opacity="0.4"') +
    THOUGHT_DOTS.map(
      (d, k) =>
        `<g opacity="${k === 0 ? 1 : 0}">${grid(d, '#e6e6e6', '#', fx + 3, -5, tp)}<animate attributeName="opacity" values="${THOUGHT_DOTS.map((_, j) => (j === k ? 1 : 0)).join(';')}" keyTimes="0;0.33;0.67" calcMode="discrete" dur="1.8s" repeatCount="indefinite"/></g>`,
    ).join('')

  // While Claude thinks, the bubble takes the props' place on the right.
  const right: Record<Mood, string> = {
    happy: drift(note, fx, [8, 5, 2, -1], 3.2) + drift(note, fx + 6, [8, 5, 2, -1], 3.2, 1.6),
    anxious: '',
    frantic: clock,
    panic: flames(fx),
    asleep:
      drift(grid(ZED, COLORS.zed, '#', 0, 0, 1.1), fx, [6, 3, 0, -3], 4) +
      drift(grid(ZED, COLORS.zed, '#', 0, 0, 0.8), fx + 7, [6, 3, 0, -3], 4, 2),
  }
  const left: Record<Mood, string> = { happy: '', anxious: sweat, frantic: sweat, panic: flames(-7), asleep: '' }
  return `<g transform="translate(8 5)">
    ${cape}${legs}<path d="${pixels(BODY, 0, 0, P)}" fill="${body}"/>
    ${headphones}${eyes}${blush}${arms}${worn}${laptop}${mug}
    ${left[mood]}${thinking ? thought : right[mood]}${sparkles}
  </g>`
}

function barSvg(t: Tank, i: number, rw: number): { svg: string; width: number } {
  const n = Math.max(6, Math.floor((rw + GAP) / (CW + GAP)))
  const width = n * (CW + GAP) - GAP
  const lit = (p: number) => (p <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, p) / 100) * n)))
  const now = lit(t.pct)
  const was = Math.min(lit(t.from), now)
  const base = TONES[tone(t.pct)]
  let empty = ''
  let fill = ''
  let fresh = ''
  const step = Math.min(30, 1000 / Math.max(1, now - was))
  for (let j = 0; j < n; j++) {
    const b = rect(j * (CW + GAP), BY, CW, BH)
    if (j >= now) {
      empty += b
      continue
    }
    // Drawn lit, so a still frame reads right; a white flash runs across the cells this reading added.
    fill += b
    if (j >= was) {
      const at = Math.round(120 + i * 140 + (j - was) * step)
      fresh += `<path d="${b}" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0.45;0" keyTimes="0;${n2(at / (at + 240))};${n2((at + 120) / (at + 240))}" calcMode="discrete" dur="${at + 240}ms" fill="freeze"/></path>`
    }
  }
  const head =
    now > 0
      ? `<path d="${rect((now - 1) * (CW + GAP), BY, CW, BH)}" fill="#fff" opacity="0">
          <animate attributeName="opacity" values="0;0.25" keyTimes="0;0.5" calcMode="discrete" dur="${tone(t.pct) === 'hot' ? 1.2 : 2}s" repeatCount="indefinite"/></path>`
      : ''
  const caret =
    t.elapsed === undefined
      ? ''
      : `<path d="${pixels(['###', '.#.'], Math.floor(t.elapsed * n) * (CW + GAP) + CW / 2 - 2.1, BY - 3.6, 1.4)}" fill="${MUTED}"/>`
  const svg = `<path d="${empty}" fill="${MUTED}" opacity="0.22"/><path d="${fill}" fill="${base}"/>
    ${fresh}${head}${caret}`
  return { svg, width }
}

// A short line beside Clawd about whichever figure is highest; none while all is calm.
function noteOf(worst: Tank): string | undefined {
  const pct = worst.pct
  if (pct >= 100) return `${cap(worst.name)} reached${worst.resetIn ? ` · resets in ${worst.resetIn}` : ''}`
  if (pct >= 95) return `${cap(worst.name)} nearly used up`
  if (pct >= 80) return `You're almost reaching your ${worst.name}`
  if (pct >= 50) return `${cap(worst.name)} is over half used`
  return undefined
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

const NOTE_CHAR = 5.9 // a 9.5px monospace advance, with a little slack

function noteSvg(note: string, x: number, color: string): { svg: string; width: number } {
  const width = noteWidthOf(note)
  const esc = note.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;')
  // A square speech bubble with a stepped pixel tail pointing back at Clawd.
  const svg = `<g transform="translate(${x} 0)">
    <path d="${pixels(['..#', '.##', '..#'], -4.5, 9, 1.5)}" fill="${MUTED}" opacity="0.45"/>
    <rect x="0.5" y="5.5" width="${width - 1}" height="13" fill="${MUTED}" fill-opacity="0.08" stroke="${MUTED}" stroke-opacity="0.45"/>
    <text x="6" y="15.2" fill="${color}" style="font: 500 9.5px ui-monospace, SFMono-Regular, Menlo, monospace">${esc}</text>
  </g>`
  return { svg, width }
}

// The same note in a few words, for when the full sentence doesn't fit.
const SHORT_NAMES: Record<string, string> = {
  'context window': 'Context',
  'session limit': 'Session',
  'weekly limit': 'Weekly',
  'spend limit': 'Spend',
}

function shortNoteOf(worst: Tank): string | undefined {
  const name = SHORT_NAMES[worst.name] ?? cap(worst.name)
  const pct = worst.pct
  if (pct >= 100) return worst.resetIn ? `${name} resets in ${worst.resetIn}` : `${name} used up`
  if (pct >= 95) return `${name} nearly out`
  if (pct >= 80) return `${name} almost full`
  if (pct >= 50) return `${name} over half`
  return undefined
}

const noteWidthOf = (note: string) => Math.round(note.length * NOTE_CHAR + 14)

const UNIT_GAP = 10 // between one figure's percentage and the next one's tag
const NOTE_GAP = 12
const MIN_BAR = 6 * (CW + GAP) - GAP
const COMFY_BAR = 12 * (CW + GAP) - GAP
const NOTE_BAR = 8 * (CW + GAP) - GAP // a short note is worth slightly shorter bars
const MAX_BAR = 56 * (CW + GAP) - GAP // past this, extra room goes between the figures

/** How the level cluster is shown: level, XP bar and streak; level and XP bar; or not at all. */
type GameFit = 'full' | 'short' | 'none'

type Plan =
  | { mode: 'bars'; note?: string; showUsd: boolean; rw: number; game: GameFit }
  | { mode: 'compact' | 'tiny'; note?: undefined; showUsd: false; game: 'none' }

// The richest arrangement that fits, giving things up in order: the level cluster's
// streak, the rest of the cluster, the long note, the cost, a little bar length, the
// short note, more bar length, then the bars themselves, then all but the highest figure.
function planOf(
  width: number,
  list: Tank[],
  usd: number | undefined,
  worst: Tank,
  game?: Record<Exclude<GameFit, 'none'>, number>,
): Plan {
  const n = list.length
  const fits = (g: GameFit, note: string | undefined, showUsd: boolean, minBar: number): Plan | undefined => {
    if (showUsd && usd === undefined) return undefined
    if (g !== 'none' && !game) return undefined
    const gw = g === 'none' || !game ? 0 : game[g] + NOTE_GAP
    const room = width - SPRITE_W - gw - (note ? noteWidthOf(note) + NOTE_GAP : 0) - (showUsd ? USD_W : 0)
    const rw = room / n - TAG_W - PCT_W - UNIT_GAP
    return rw >= minBar ? { mode: 'bars', note, showUsd, rw: Math.min(MAX_BAR, rw), game: g } : undefined
  }
  const long = noteOf(worst)
  const short = shortNoteOf(worst)
  return (
    fits('full', long, true, COMFY_BAR) ??
    fits('full', long, false, COMFY_BAR) ??
    fits('short', long, false, COMFY_BAR) ??
    fits('none', long, true, COMFY_BAR) ??
    fits('none', long, false, COMFY_BAR) ??
    fits('none', short, true, COMFY_BAR) ??
    fits('none', short, false, COMFY_BAR) ??
    fits('none', short, false, NOTE_BAR) ??
    fits('none', undefined, true, COMFY_BAR) ??
    fits('none', undefined, false, COMFY_BAR) ??
    fits('none', undefined, false, MIN_BAR) ??
    (width - SPRITE_W >= n * compactUnitWidth(list)
      ? { mode: 'compact', showUsd: false, game: 'none' }
      : { mode: 'tiny', showUsd: false, game: 'none' })
  )
}

const compactUnitWidth = (list: Tank[]) =>
  Math.max(...list.map(t => textWidth(t.tag) + 5 + textWidth(`${Math.round(t.pct)}%`))) + UNIT_GAP + 4

function pixelSvg(list: Tank[], usd: number | undefined, doing: Activity, width: number, view?: GameView): string {
  const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
  const mood = moodOf(worst.pct)
  const sizes = view ? { full: gameSvg(view, 0, 'full').width, short: gameSvg(view, 0, 'short').width } : undefined
  const plan = planOf(width, list, usd, worst, sizes)
  const cluster = view && plan.game !== 'none' ? gameSvg(view, SPRITE_W, plan.game) : undefined
  const noteX = SPRITE_W + (cluster ? cluster.width + NOTE_GAP : 0)
  const note = plan.note ? noteSvg(plan.note, noteX, TONES[tone(worst.pct)]) : undefined
  const left = noteX + (note ? note.width + NOTE_GAP : 0)
  const ty = BY + (BH - 5 * FP) / 2
  const figure = (t: Tank, x: number, body: string) =>
    `<g transform="translate(${n2(x)} 0)"${t.isSaved ? ' opacity="0.5"' : ''}>${body}</g>`
  const label = (t: Tank, x: number) =>
    `<path d="${textPixels(`${Math.round(t.pct)}%`, x, ty)}" fill="${TONES[tone(t.pct)]}"/>`
  const tag = (t: Tank) => `<path d="${textPixels(t.tag, 0, ty)}" fill="${MUTED}"/>`

  let units: string[]
  if (plan.mode === 'bars') {
    const unit = (width - left - (plan.showUsd ? USD_W : 0)) / list.length
    units = list.map((t, i) => {
      const bar = barSvg(t, i, plan.rw)
      return figure(t, left + i * unit, `${tag(t)}<g transform="translate(${TAG_W} 0)">${bar.svg}</g>${label(t, TAG_W + bar.width + 5)}`)
    })
  } else {
    // No room for bars: the figures alone, or just the highest one.
    const shown = plan.mode === 'compact' ? list : [worst]
    const unit = compactUnitWidth(list)
    units = shown.map((t, i) => figure(t, left + i * unit, tag(t) + label(t, textWidth(t.tag) + 5)))
  }
  if (plan.showUsd && usd !== undefined) {
    const s = `$${usd.toFixed(2)}`
    units.push(`<path d="${textPixels(s, width - textWidth(s) - 2, ty)}" fill="${MUTED}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" shape-rendering="crispEdges">
  ${clawdSvg(mood, doing, view?.wear, view?.burst)}
  ${cluster?.svg ?? ''}${note?.svg ?? ''}
  ${units.join('\n')}
</svg>`
}

// Levels: each costs 100 XP more than the last, so level L needs 50·L·(L−1) XP in all.
const xpFor = (level: number) => 50 * level * (level - 1)

function levelOf(xp: number): number {
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2))
  while (xpFor(level + 1) <= xp) level++
  while (level > 1 && xpFor(level) > xp) level--
  return level
}

// Milestones: a title from each, and something to wear from most.
const LEVELS: { at: number; title: string; item?: string }[] = [
  { at: 1, title: 'Hatchling' },
  { at: 3, title: 'Hatchling', item: 'scarf' },
  { at: 5, title: 'Apprentice', item: 'beanie' },
  { at: 10, title: 'Tinkerer', item: 'sunglasses' },
  { at: 15, title: 'Builder', item: 'hardhat' },
  { at: 20, title: 'Architect', item: 'cape' },
  { at: 30, title: 'Wizard', item: 'wizard' },
  { at: 50, title: 'Legend', item: 'golden' },
]

const ITEM_NAMES: Record<string, string> = {
  scarf: 'scarf',
  beanie: 'beanie',
  sunglasses: 'sunglasses',
  hardhat: 'hard hat',
  cape: 'cape',
  wizard: 'wizard hat',
  golden: 'golden shell',
}

const reached = (level: number) => LEVELS.filter(m => m.at <= level)
const titleOf = (level: number) => reached(level).at(-1)?.title ?? 'Hatchling'
const itemsOf = (level: number) => reached(level).flatMap(m => (m.item ? [m.item] : []))

/** What Clawd wears: the pick, if it's unlocked; else the newest unlock. `none` wears nothing. */
function wornOf(level: number, wear?: string): string | undefined {
  const items = itemsOf(level)
  if (wear === 'none') return undefined
  return wear && items.includes(wear) ? wear : items[items.length - 1]
}

/** A local calendar date as `YYYY-MM-DD`. */
function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whole days from one `YYYY-MM-DD` to another; negative if the second is earlier. */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** A streak is still alive if the days missed since its last day can be covered by rest days. */
function liveStreak(p: Progress, now: number): number {
  const s = p.streak
  if (!s.lastDay) return 0
  const missed = daysBetween(s.lastDay, dayOf(now)) - 1
  return missed <= s.restDays ? s.count : 0
}

type GameView = { level: number; frac: number; streak: number; wear?: string; burst?: boolean }

function gameViewOf(p: Progress, now: number, burst = false): GameView {
  const level = levelOf(p.xp)
  const frac = (p.xp - xpFor(level)) / (xpFor(level + 1) - xpFor(level))
  return { level, frac, streak: liveStreak(p, now), wear: wornOf(level, p.wear), burst }
}

// The level cluster beside Clawd: `Lv7` over a thin XP bar, then a flame and the streak
// from its third day.
function gameSvg(v: GameView, x: number, fit: Exclude<GameFit, 'none'>): { svg: string; width: number } {
  const ty = BY + (BH - 5 * FP) / 2
  const lv = `Lv${v.level}`
  const lw = textWidth(lv)
  const xy = ty + 5 * FP + 2.4
  let svg =
    `<path d="${textPixels(lv, 0, ty)}" fill="${COLORS.level}"/>` +
    `<path d="${rect(0, xy, lw, 1.6)}" fill="${MUTED}" opacity="0.3"/>` +
    (v.frac > 0 ? `<path d="${rect(0, xy, n2(Math.max(1, lw * v.frac)), 1.6)}" fill="${COLORS.level}"/>` : '')
  let width = lw
  if (fit === 'full' && v.streak >= 3) {
    const fx = lw + 7
    const count = `${v.streak}`
    svg +=
      grid4(FLAME_A, COLORS.flameOut, 'r', fx, ty + 1.7) +
      grid4(FLAME_A, COLORS.flameIn, 'y', fx, ty + 1.7) +
      `<path d="${textPixels(count, fx + 7.6, ty)}" fill="${MUTED}"/>`
    width = fx + 7.6 + textWidth(count)
  }
  return { svg: `<g transform="translate(${n2(x)} 0)">${svg}</g>`, width: Math.round(width) }
}

const grid4 = (g: string[], fill: string, ch: string, x: number, y: number) =>
  `<path d="${pixels(g, x, y, 1.4, ch)}" fill="${fill}"/>`

const FACES: Record<Mood, string> = {
  happy: '(^‿^)',
  anxious: '(・_・;)',
  frantic: '(°□°;)',
  panic: '(ﾟДﾟ;)',
  asleep: '(-_-) zZ',
}

// #endregion drawing

// #region game: pure, no $; what each turn and reading earns
const XP = {
  turn: 10,
  tiredTurn: 2, // each turn after the first 60 of a day
  turnsBeforeTired: 60,
  daily: 25,
  weeklyPoint: 5,
  paced: 100, // a 5-hour window that peaked at 60–99%
  light: 40, // one that peaked at 30–59%
  badge: 50,
}

const BADGES: Record<string, { name: string; how: string }> = {
  'first-steps': { name: 'First Steps', how: 'your first turn with Clawd' },
  'on-a-roll': { name: 'On a Roll', how: 'a 7-day streak' },
  unstoppable: { name: 'Unstoppable', how: 'a 30-day streak' },
  'close-call': { name: 'Close Call', how: 'a week that peaked at 95–99%' },
  zen: { name: 'Zen', how: 'a week that stayed under 50%' },
  'perfect-pace': { name: 'Perfect Pace', how: 'three well-paced 5-hour windows in a row' },
  phoenix: { name: 'Phoenix', how: 'back at it after a limit you hit reset' },
  marathon: { name: 'Marathon', how: '100 tool calls in one session' },
  'deep-thinker': { name: 'Deep Thinker', how: 'context past 80%' },
  'fresh-start': { name: 'Fresh Start', how: 'a busy context cleared' },
  'night-owl': { name: 'Night Owl', how: 'a turn between 2 and 5am' },
  'early-bird': { name: 'Early Bird', how: 'a turn between 5 and 7am' },
}

function newProgress(): Progress {
  return {
    xp: 0,
    turns: 0,
    tokensIn: 0,
    tokensOut: 0,
    streak: { count: 0, best: 0, restDays: 0 },
    badges: {},
    today: { day: '', turns: 0 },
    windows: {},
    paced: 0,
    phoenix: false,
  }
}

/** The saved progress, with any field an older version didn't keep filled in. */
function progressOf(saved: unknown): Progress {
  const base = newProgress()
  if (!saved || typeof saved !== 'object') return base
  return { ...base, ...(saved as Partial<Progress>) }
}

/** A change to the progress and what to tell the person about it. */
type Step = { p: Progress; news: string[] }

const stepFrom = (p: Progress): Step => ({ p: JSON.parse(JSON.stringify(p)), news: [] })

function earn(step: Step, id: string, day: string) {
  if (step.p.badges[id] || !BADGES[id]) return
  step.p.badges[id] = day
  step.p.xp += XP.badge
  step.news.push(`Badge earned: ${BADGES[id].name}, ${BADGES[id].how} (+${XP.badge} XP)`)
}

type TurnFacts = {
  now: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
  /** Tool calls so far this session, main conversation only. */
  tools: number
}

function afterTurn(prev: Progress, t: TurnFacts): Step {
  const step = stepFrom(prev)
  const p = step.p
  const day = dayOf(t.now)
  p.turns += 1
  if (t.usage) {
    p.tokensIn += t.usage.input_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens
    p.tokensOut += t.usage.output_tokens
  }

  // The first turn of a day carries the streak on, spending rest days on any days missed.
  const s = p.streak
  const gap = s.lastDay ? daysBetween(s.lastDay, day) : 1
  if (gap >= 1) {
    const missed = gap - 1
    if (s.lastDay && missed <= s.restDays) {
      if (missed > 0) step.news.push(`A rest day kept your ${s.count}-day streak going`)
      s.restDays -= missed
      s.count += 1
    } else {
      s.count = 1
    }
    if (s.count % 7 === 0) s.restDays = Math.min(2, s.restDays + 1)
    s.best = Math.max(s.best, s.count)
    s.lastDay = day
    p.xp += XP.daily
  }

  if (p.today.day !== day) p.today = { day, turns: 0 }
  p.xp += p.today.turns < XP.turnsBeforeTired ? XP.turn : XP.tiredTurn
  p.today.turns += 1

  const hour = new Date(t.now).getHours()
  earn(step, 'first-steps', day)
  if (s.count >= 7) earn(step, 'on-a-roll', day)
  if (s.count >= 30) earn(step, 'unstoppable', day)
  if (hour >= 2 && hour < 5) earn(step, 'night-owl', day)
  if (hour >= 5 && hour < 7) earn(step, 'early-bird', day)
  if (t.tools >= 100) earn(step, 'marathon', day)
  if (p.phoenix) {
    earn(step, 'phoenix', day)
    p.phoenix = false
  }
  return step
}

// A window has ended: score how it went.
function scoreWindow(step: Step, kind: string, peak: number, day: string) {
  const p = step.p
  if (peak >= 100) p.phoenix = true
  if (kind === 'five_hour') {
    if (peak >= 60 && peak < 100) {
      p.xp += XP.paced
      p.paced += 1
      step.news.push(`Nicely paced session window (+${XP.paced} XP)`)
      if (p.paced >= 3) earn(step, 'perfect-pace', day)
    } else {
      p.paced = 0
      if (peak >= 30 && peak < 60) p.xp += XP.light
    }
  }
  if (kind === 'seven_day') {
    if (peak >= 95 && peak < 100) earn(step, 'close-call', day)
    if (peak > 0 && peak < 50) earn(step, 'zen', day)
  }
}

/** `prevCtx` is the context figure from this session's previous reading. */
function afterMeasure(prev: Progress, snap: Snapshot, now: number, prevCtx?: number): Step {
  const step = stepFrom(prev)
  const p = step.p
  const day = dayOf(now)
  for (const l of snap.limits) {
    if (l.isSaved) continue
    // A reading whose window has already ended is left from before the reset; wait for a fresh one.
    if (l.resetsAt && Date.parse(l.resetsAt) <= now) continue
    const w = p.windows[l.kind]
    if (!w) {
      // First sight: nothing is earned for what was used before the game began.
      p.windows[l.kind] = { resetsAt: l.resetsAt, peak: l.pct }
      continue
    }
    const ended = w.resetsAt !== undefined && Date.parse(w.resetsAt) <= now
    if (ended) scoreWindow(step, l.kind, w.peak, day)
    const from = ended ? 0 : w.peak
    if (l.kind === 'seven_day' && l.pct > from) p.xp += XP.weeklyPoint * (l.pct - from)
    p.windows[l.kind] = { resetsAt: l.resetsAt ?? w.resetsAt, peak: Math.max(from, l.pct) }
  }
  if (snap.ctxPct >= 80) earn(step, 'deep-thinker', day)
  if (prevCtx !== undefined && prevCtx > 50 && snap.ctxPct < 10) earn(step, 'fresh-start', day)
  return step
}

function statsOf(p: Progress, now: number): string {
  const level = levelOf(p.xp)
  const xp = Math.floor(p.xp)
  const items = itemsOf(level)
  const worn = wornOf(level, p.wear)
  const all = Object.entries(BADGES)
  const earned = all.filter(([id]) => p.badges[id]).map(([, b]) => b.name)
  const left = all.filter(([id]) => !p.badges[id]).map(([, b]) => `${b.name} (${b.how})`)
  const streak = liveStreak(p, now)
  const next = LEVELS.find(m => m.at > level)
  return [
    `Clawd · level ${level}, ${titleOf(level)} · ${xp.toLocaleString('en-US')} XP, ${(xpFor(level + 1) - xp).toLocaleString('en-US')} to level ${level + 1}`,
    `Streak: ${streak} day${streak === 1 ? '' : 's'} (best ${p.streak.best}) · ${p.streak.restDays} rest day${p.streak.restDays === 1 ? '' : 's'} saved`,
    `Turns: ${p.turns.toLocaleString('en-US')} · tokens: ${tokens(p.tokensIn)} in, ${tokens(p.tokensOut)} out`,
    items.length
      ? `Wearing: ${worn ? ITEM_NAMES[worn] : 'nothing'} · unlocked: ${items.map(i => ITEM_NAMES[i]).join(', ')} (/usage-hud wear <item>)`
      : `Nothing to wear yet; the scarf comes at level 3`,
    next ? `Next: ${next.title === titleOf(level) ? '' : `${next.title}, `}${next.item ? ITEM_NAMES[next.item] : ''} at level ${next.at}` : '',
    `Badges ${earned.length}/${all.length}: ${earned.join(', ') || 'none yet'}`,
    left.length ? `Still to earn: ${left.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The item a `/usage-hud wear` argument names, by id or by name; `none` takes it all off. */
function itemNamed(arg: string): string | undefined {
  const want = arg.trim().toLowerCase()
  if (want === 'none' || want === 'nothing') return 'none'
  return Object.keys(ITEM_NAMES).find(id => id === want || ITEM_NAMES[id] === want)
}
// #endregion game

function bar(pct: number, cells = 5): string {
  const full = Math.round((Math.min(100, pct) / 100) * cells)
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

let settle: { cancel: () => void } | undefined

const SAVED = 'limits'

// The limits arrive with API responses, so a new session has none until its first
// reply. Keep the last ones in the store and stand them in until then; a window whose
// reset time has passed since is shown empty.
async function withSaved($: EngineInterface, snap: Snapshot): Promise<Snapshot> {
  if (snap.limits.length > 0) {
    await $.store.set(SAVED, snap.limits)
    return snap
  }
  const saved = (await $.store.get(SAVED)) as Limit[] | undefined
  if (!Array.isArray(saved) || saved.length === 0) return snap
  const now = await $.clock.now()
  const limits = saved.map(l =>
    l.resetsAt && Date.parse(l.resetsAt) <= now
      ? { kind: l.kind, pct: 0, isSaved: true }
      : { ...l, isSaved: true },
  )
  return { ...snap, limits }
}

const PROGRESS = 'progress'
let playing: Promise<unknown> = Promise.resolve()
let sparkle: { cancel: () => void } | undefined

// Applies one change to Clawd's progress, one change at a time: read fresh from the
// store (another session may have moved it on), changed, saved, drawn, announced.
async function play($: EngineInterface, change: (p: Progress, now: number) => Step) {
  const run = playing.then(async () => {
    const now = await $.clock.now()
    const before = progressOf(await $.store.get(PROGRESS))
    const { p, news } = change(before, now)
    await $.store.set(PROGRESS, p)
    const was = levelOf(before.xp)
    const is = levelOf(p.xp)
    await update($, game, (g: Game) => ({ progress: p, burst: is > was || g.burst }))
    if (is > was) {
      const unlock = LEVELS.filter(m => m.at > was && m.at <= is && m.item).pop()?.item
      $.ui.toast(`Clawd reached level ${is}: ${titleOf(is)}${unlock ? `, ${ITEM_NAMES[unlock]} unlocked` : ''}`)
      sparkle?.cancel()
      sparkle = $.clock.after(2600, () => {
        void update($, game, (g: Game) => ({ ...g, burst: false }))
      })
    }
    for (const line of news) $.ui.toast(line)
  })
  // A failed change is dropped; the game never gets in the way of the band.
  playing = run.catch(() => undefined)
  return playing
}

// This session's own counts, for the badges that are about one session.
let toolCalls = 0
let lastCtx: number | undefined

async function take($: EngineInterface, fresh: Snapshot) {
  const snap = await withSaved($, fresh)
  const before = (await read($, gauges)).cur
  await update($, gauges, g => ({ cur: snap, prev: g.cur }))
  for (const l of snap.limits) {
    const was = before?.limits.find(p => p.kind === l.kind)?.pct
    const crossed = WARN_AT.filter(at => l.pct >= at && (was ?? 0) < at).pop()
    if (was !== undefined && crossed !== undefined) {
      $.ui.toast(`Clawd is sweating: ${TAGS[l.kind]?.name ?? l.kind} limit passed ${crossed}%`)
    }
  }
  // Once the fill has played, let prev catch up so later redraws don't replay it.
  settle?.cancel()
  settle = $.clock.after(SWEEP_MS + 800, () => {
    void update($, gauges, (g: Gauges) => ({ cur: g.cur, prev: g.cur }))
  })
  const prevCtx = lastCtx
  lastCtx = snap.ctxPct
  await play($, (p, now) => afterMeasure(p, snap, now, prevCtx))
}

// Re-reads the figures now: the countdowns and pace marks move at once; the
// limits themselves change only when a response has reported new ones.
async function refresh($: EngineInterface) {
  await take($, snapshotOf(await $.session.usage()))
  $.ui.toast('Usage refreshed', { timeoutMs: 1500 })
}

// Writes only on a change, since a response streams many chunks of the same kind.
let doing: Activity = 'idle'

async function setActivity($: EngineInterface, next: Activity) {
  if (next === doing) return
  doing = next
  await update($, activity, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-hud',
      description: "Show or hide the usage band; `stats` for Clawd's level and badges, `wear <item>` to dress him",
      argumentHint: '[stats | wear <item>]',
    })
    const saved = progressOf(await $.store.get(PROGRESS))
    await update($, game, () => ({ progress: saved, burst: false }))
    await take($, snapshotOf(await $.session.usage()))
    // Redraw each minute so the pace marks and reset times stay current.
    $.clock.every(60_000, () => {
      void update($, gauges, (g: Gauges) => ({ cur: g.cur, prev: g.cur }))
    })
    return next(e)
  })

  // What Claude is doing, from the main conversation only, so subagents don't flicker it.
  // A request is thinking until text or a tool call arrives; then it's at the laptop.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    await setActivity($, 'thinking')
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking') await setActivity($, 'thinking')
      else if (chunk.kind === 'text' || chunk.kind === 'tool' || chunk.kind === 'input') await setActivity($, 'typing')
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) {
      toolCalls += 1
      await setActivity($, 'typing')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, 'idle')
    if (!e.agentId) await play($, (p, now) => afterTurn(p, { now, usage: e.usage, tools: toolCalls }))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await take($, snapshotOf(e))
    return next(e)
  })

  on('command.run', { command: 'usage-hud' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'stats') {
      return { text: statsOf(progressOf(await $.store.get(PROGRESS)), await $.clock.now()) }
    }
    if (verb === 'wear') {
      const p = progressOf(await $.store.get(PROGRESS))
      const items = itemsOf(levelOf(p.xp))
      const pick = itemNamed(rest.join(' '))
      if (!pick || (pick !== 'none' && !items.includes(pick))) {
        const owned = items.length ? items.map(i => ITEM_NAMES[i]).join(', ') : 'nothing yet (the scarf comes at level 3)'
        return { text: `Clawd can wear: ${owned}. Try /usage-hud wear <item>, or wear none.` }
      }
      await play($, q => ({ p: { ...q, wear: pick }, news: [] }))
      return { text: pick === 'none' ? 'Clawd took everything off.' : `Clawd is wearing the ${ITEM_NAMES[pick]}.` }
    }
    let hidden = false
    await update($, isHidden, h => (hidden = !h))
    return { text: hidden ? 'Usage roads hidden.' : 'Usage roads shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { cur, prev } = await read($, gauges)
    if (!cur) return next(e)

    const now = await $.clock.now()
    const list = tanksOf(cur, prev, now)
    const { progress, burst } = await read($, game)
    const view = progress ? gameViewOf(progress, now, burst) : undefined

    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      const columns = e.props.bodyColumns || e.viewport?.columns || 100
      // The image can't take a press, so the refresh control is a real Button beside it.
      const width = Math.max(160, Math.round(columns * PX_PER_COLUMN) - REFRESH_W)
      // Drawn as an image, not an interactive frame: it stays transparent, and SMIL still plays.
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={pixelSvg(list, cur.usd, e.props.isWorking ? await read($, activity) : 'idle', width, view)}
            alt={(view ? [`Level ${view.level}`] : []).concat(list.map(t => `${t.tag} ${Math.round(t.pct)}%`)).join(', ')}
            width={width}
            height={HEIGHT}
          />
          <Button key="refresh" label="↻" plain dimColor onPress={() => refresh($)} />
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const color = (pct: number) => ({ ok: 'cyan', warn: 'yellow', hot: 'red' })[tone(pct)]
      const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
      const face = FACES[moodOf(worst.pct)]
      const usd = cur.usd === undefined ? '' : `$${cur.usd.toFixed(2)}`
      // The level as `Lv7 ▰▰▱ 🔥5`; the flame counts as two columns.
      const level = view ? `Lv${view.level}` : ''
      const xpBar = view ? bar(view.frac * 100, 3) : ''
      const flame = view && view.streak >= 3 ? `🔥${view.streak}` : ''
      const gameWidth = (g: GameFit) =>
        !view || g === 'none' ? 0 : level.length + 1 + xpBar.length + 2 + (g === 'full' && flame ? flame.length + 2 : 0)
      // Fit the row to the terminal: give up the streak, the level, the long note, the cost,
      // the short note, then the bars.
      const cols = e.props.bodyColumns || e.viewport?.columns || 80
      const figures = (bars: boolean) => list.reduce((w, t) => w + t.tag.length + (bars ? 6 : 0) + 5 + 2, 0)
      const widthOf = (bars: boolean, note: string | undefined, cost: string | undefined, g: GameFit) =>
        face.length + 2 + gameWidth(g) + figures(bars) + (cost ? cost.length + 2 : 0) + (note ? note.length + 2 : 0) + 3
      const options: [boolean, string | undefined, string | undefined, GameFit][] = [
        [true, noteOf(worst), usd, 'full'],
        [true, noteOf(worst), undefined, 'full'],
        [true, noteOf(worst), undefined, 'short'],
        [true, noteOf(worst), usd, 'none'],
        [true, noteOf(worst), undefined, 'none'],
        [true, shortNoteOf(worst), usd, 'none'],
        [true, shortNoteOf(worst), undefined, 'none'],
        [true, undefined, usd, 'none'],
        [true, undefined, undefined, 'none'],
        [false, undefined, undefined, 'none'],
      ]
      const fitting = options.filter(([, , , g]) => view || g === 'none')
      const [bars, note, cost, g] = fitting.find(([b, n, c, f]) => widthOf(b, n, c, f) <= cols) ?? fitting[fitting.length - 1]!
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="#D97757">{face}</Text>
          {g !== 'none' ? (
            <Text>
              <Text color="magenta">{level} </Text>
              <Text color="magenta" dimColor>{xpBar}</Text>
              {g === 'full' && flame ? <Text dimColor>{`  ${flame}`}</Text> : null}
            </Text>
          ) : null}
          {list.map(t => (
            <Text>
              <Text dimColor>{t.tag} </Text>
              {bars ? <Text color={color(t.pct)}>{bar(t.pct)} </Text> : null}
              <Text bold color={bars ? undefined : color(t.pct)} dimColor={t.isSaved}>{Math.round(t.pct)}%</Text>
            </Text>
          ))}
          {cost ? <Text dimColor>{cost}</Text> : null}
          {note ? <Text color={color(worst.pct)}>{note}</Text> : null}
          <Button key="refresh" label="↻" plain dimColor hotkey="r" onPress={() => refresh($)} />
        </Box>
      )
    }

    return next(e)
  })
}
