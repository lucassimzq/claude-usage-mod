import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Activity, Game, Gauges, Limit, Progress, Recap, Snapshot, Today, Update, Week } from '../types'

const gauges = atom({ plugin: 'usage-hud', key: 'gauges' } as const, { cur: null, prev: null })
const isHidden = atom({ plugin: 'usage-hud', key: 'isHidden' } as const, false)
const activity = atom({ plugin: 'usage-hud', key: 'activity' } as const, 'idle')
const game = atom({ plugin: 'usage-hud', key: 'game' } as const, { progress: null, burst: false })
const updates = atom({ plugin: 'usage-hud', key: 'update' } as const, { current: '0.0.0', phase: 'idle' })

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
  k: ['#..', '#.#', '##.', '#.#', '#.#'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
}

/** `s` in the pixel font, `p` px to a font pixel. */
function textPixels(s: string, x: number, y: number, p = FP): string {
  return [...s].map((ch, i) => pixels(FONT[ch] ?? [], x + i * 4 * p, y, p)).join('')
}

const textWidth = (s: string, p = FP) => (s.length * 4 - 1) * p

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
// And what the shop sells.
const WINGS = ['#...........#', '##.........##', '##.........##']
const PARTY_HAT = ['......#......', '.....#y#.....', '....#####....']
const CAP = ['', '...#######...', '..##########.']
const CROWN = ['...#.#.#.#...', '...#######...', '...#y###y#...']
const FLOWER = ['.........#.#.', '.........#y#.', '.........#.#.']
const HALO = ['...#######...']
const MONOCLE = ['......#####..', '......#...#..', '......#...#..', '......#...#..', '......#####..', '..........#..']
const SPECS = ['...###.###...', '..#...#...#..', '..#...#...#..', '..#...#...#..', '...###.###...']
const MUSTACHE = ['', '', '', '', '....##.##....', '...##...##...']
const BOW_TIE = ['', '', '', '', '', '....##y##....', '....#...#....']
const MEDAL = ['', '', '', '', '', '.....#.#.....', '......y......']
const PLANT = ['g.g.', '.g..', 'ppp.', 'ppp.']
const TINY_CRAB = ['#####', '#k#k#', '#####', '.#.#.']

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
  coin: '#d1ad55',
  wings: '#e2e2e2',
  party: '#d98fa0',
  cap: '#6b8fc4',
  gem: '#c06565',
  frames: '#3a3a3a',
  mustache: '#5a3d2b',
  bow: '#c06565',
  knot: '#8f4646',
  leaf: '#6b9e7a',
  pot: '#b9775f',
}

const SHELLS: Record<string, string> = {
  golden: '#d9b25a',
  mint: '#86b89a',
  lilac: '#a99be0',
  rose: '#d98fa0',
  midnight: '#56679a',
}

// Each mood is a small scene, not a dance: Clawd holds still and one prop moves, slowly.
// `props` false leaves out the scene (headphones, notes, mug, flames): Clawd alone, as the shop shows him.
function clawdSvg(mood: Mood, doing: Activity, outfit: Record<string, string> = {}, burst = false, props = true): string {
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
  const holdsMug = props && !typing && (mood === 'anxious' || mood === 'panic')
  const shell = outfit.shell ? SHELLS[outfit.shell] : undefined
  const body = shell ?? (mood === 'asleep' ? COLORS.sleepy : CLAWD)
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
  const headphones = props && mood === 'happy' ? grid(HEADPHONES, COLORS.band, 'b', 0, -P) + grid(HEADPHONES, COLORS.cups, 'c', 0, -P) : ''
  const tense = mood === 'frantic' || mood === 'panic' || mood === 'asleep'
  const hat = -2 * P
  const art: Record<string, () => string> = {
    scarf: () => grid(SCARF, COLORS.scarf),
    beanie: () => grid(BEANIE, COLORS.beanie, '#', 0, hat) + grid(BEANIE, COLORS.beanieBrim, 'd', 0, hat),
    sunglasses: () => (tense ? grid(SHADES_UP, INK) : grid(SHADES, INK)),
    hardhat: () => grid(HARD_HAT, COLORS.hardHat, '#', 0, hat) + grid(HARD_HAT, COLORS.shine, 'y', 0, hat),
    wizard: () => grid(WIZARD_HAT, COLORS.wizard, '#', 0, hat) + grid(WIZARD_HAT, COLORS.shine, 'y', 0, hat),
    cape: () => grid(CAPE, COLORS.cape),
    wings: () => grid(WINGS, COLORS.wings),
    party: () => grid(PARTY_HAT, COLORS.party, '#', 0, hat) + grid(PARTY_HAT, COLORS.shine, 'y', 0, hat),
    cap: () => grid(CAP, COLORS.cap, '#', 0, hat),
    crown: () => grid(CROWN, COLORS.golden, '#', 0, hat) + grid(CROWN, COLORS.gem, 'y', 0, hat),
    flower: () => grid(FLOWER, COLORS.party, '#', 0, hat) + grid(FLOWER, COLORS.shine, 'y', 0, hat),
    halo: () => grid(HALO, COLORS.shine, '#', 0, hat),
    monocle: () => grid(MONOCLE, COLORS.golden),
    specs: () => grid(SPECS, COLORS.frames),
    mustache: () => grid(MUSTACHE, COLORS.mustache),
    bowtie: () => grid(BOW_TIE, COLORS.bow) + grid(BOW_TIE, COLORS.knot, 'y'),
    medal: () => grid(MEDAL, COLORS.scarf) + grid(MEDAL, COLORS.shine, 'y'),
    // A buddy sits on Clawd's left; it steps aside for the flames.
    plant: () => (mood === 'panic' ? '' : grid(PLANT, COLORS.leaf, 'g', -8, 12, 1.2) + grid(PLANT, COLORS.pot, 'p', -8, 12, 1.2)),
    crab: () => (mood === 'panic' ? '' : grid(TINY_CRAB, CLAWD, '#', -8, 11.6, 1.3) + grid(TINY_CRAB, INK, 'k', -8, 11.6, 1.3)),
  }
  const wearing = (slot: string) => {
    const id = outfit[slot]
    return (id && art[id]?.()) || ''
  }
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
    ${wearing('back')}${legs}<path d="${pixels(BODY, 0, 0, P)}" fill="${body}"/>
    ${headphones}${eyes}${blush}${arms}${wearing('neck')}${wearing('face')}${wearing('head')}${laptop}${mug}${wearing('buddy')}
    ${props ? left[mood] : ''}${thinking ? thought : props ? right[mood] : ''}${sparkles}
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  ${clawdSvg(mood, doing, view?.outfit, view?.burst)}
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

type Slot = 'head' | 'face' | 'neck' | 'back' | 'shell' | 'buddy'
const SLOTS: Slot[] = ['head', 'face', 'neck', 'back', 'shell', 'buddy']

// Everything Clawd can wear: level unlocks (no price) and the shop, cheapest first.
// `level` on a shop item is the level it needs before it can be bought.
const ITEMS: Record<string, { name: string; slot: Slot; price?: number; level?: number }> = {
  scarf: { name: 'scarf', slot: 'neck' },
  beanie: { name: 'beanie', slot: 'head' },
  sunglasses: { name: 'sunglasses', slot: 'face' },
  hardhat: { name: 'hard hat', slot: 'head' },
  cape: { name: 'cape', slot: 'back' },
  wizard: { name: 'wizard hat', slot: 'head' },
  golden: { name: 'golden shell', slot: 'shell' },
  bowtie: { name: 'bow tie', slot: 'neck', price: 50 },
  flower: { name: 'flower', slot: 'head', price: 80 },
  cap: { name: 'cap', slot: 'head', price: 100 },
  mustache: { name: 'mustache', slot: 'face', price: 120 },
  party: { name: 'party hat', slot: 'head', price: 150 },
  plant: { name: 'desk plant', slot: 'buddy', price: 150 },
  specs: { name: 'round glasses', slot: 'face', price: 200 },
  mint: { name: 'mint shell', slot: 'shell', price: 250 },
  lilac: { name: 'lilac shell', slot: 'shell', price: 250 },
  rose: { name: 'rose shell', slot: 'shell', price: 250 },
  monocle: { name: 'monocle', slot: 'face', price: 300 },
  medal: { name: 'medal', slot: 'neck', price: 500, level: 10 },
  midnight: { name: 'midnight shell', slot: 'shell', price: 600 },
  crab: { name: 'tiny crab', slot: 'buddy', price: 800, level: 5 },
  halo: { name: 'halo', slot: 'head', price: 1200, level: 15 },
  wings: { name: 'wings', slot: 'back', price: 1500, level: 25 },
  crown: { name: 'crown', slot: 'head', price: 2000, level: 20 },
}

const nameOf = (id: string) => ITEMS[id]?.name ?? id

const reached = (level: number) => LEVELS.filter(m => m.at <= level)
const titleOf = (level: number) => reached(level).at(-1)?.title ?? 'Hatchling'
const itemsOf = (level: number) => reached(level).flatMap(m => (m.item ? [m.item] : []))

const owns = (p: Progress, level: number, id: string) => itemsOf(level).includes(id) || (p.owned ?? []).includes(id)

/** What Clawd wears, slot by slot: the pick if it's owned, else the newest level unlock for that slot. */
function outfitOf(p: Progress, level: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of itemsOf(level)) {
    const slot = ITEMS[id]?.slot
    if (slot) out[slot] = id
  }
  for (const [slot, id] of Object.entries(p.outfit ?? {})) {
    if (id === 'none') delete out[slot]
    else if (owns(p, level, id)) out[slot] = id
  }
  return out
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

type GameView = {
  level: number
  frac: number
  streak: number
  coins?: number
  outfit?: Record<string, string>
  burst?: boolean
  /** Today's quests: how many are done, of how many. */
  quests?: { done: number; of: number }
}

function gameViewOf(p: Progress, now: number, burst = false): GameView {
  const level = levelOf(p.xp)
  const frac = (p.xp - xpFor(level)) / (xpFor(level + 1) - xpFor(level))
  return { level, frac, streak: liveStreak(p, now), coins: p.coins, outfit: outfitOf(p, level), burst }
}

/** A coin count in at most four characters: `950`, `1.2k`, `12k`, `120k`. */
function coinsLabel(n: number): string {
  const c = Math.max(0, Math.floor(n))
  if (c < 1000) return `${c}`
  if (c < 10_000) return `${Math.floor(c / 100) / 10}k`
  return `${Math.floor(c / 1000)}k`
}

const COIN = ['.###.', '#####', '#####', '#####', '.###.']
const LV_P = 1.4 // the level's font pixel, a little smaller than the bars' so the coins fit below
const COIN_P = 1.2

// The level cluster beside Clawd: `Lv7` over a thin XP bar and the coin balance, then a
// flame and the streak from its third day.
function gameSvg(v: GameView, x: number, fit: Exclude<GameFit, 'none'>): { svg: string; width: number } {
  const ty = BY + (BH - 5 * FP) / 2
  const lv = `Lv${v.level}`
  const hasCoins = v.coins !== undefined
  // Without coins the level sits level with the figures; with them the three rows share the height.
  const p = hasCoins ? LV_P : FP
  const ly = hasCoins ? 2.5 : ty
  const xy = ly + 5 * p + (hasCoins ? 1.6 : 2.4)
  const cy = xy + 1.6 + 2.4
  const coins = hasCoins ? coinsLabel(v.coins!) : ''
  const cw = hasCoins ? 5 * COIN_P + 2 + textWidth(coins, COIN_P) : 0
  const lw = Math.max(textWidth(lv, p), cw)
  let svg =
    `<path d="${textPixels(lv, 0, ly, p)}" fill="${COLORS.level}"/>` +
    `<path d="${rect(0, xy, n2(lw), 1.6)}" fill="${MUTED}" opacity="0.3"/>` +
    (v.frac > 0 ? `<path d="${rect(0, xy, n2(Math.max(1, lw * v.frac)), 1.6)}" fill="${COLORS.level}"/>` : '')
  if (hasCoins) {
    svg +=
      `<path d="${pixels(COIN, 0, cy, COIN_P)}" fill="${COLORS.coin}"/>` +
      `<path d="${textPixels(coins, 5 * COIN_P + 2, cy, COIN_P)}" fill="${MUTED}"/>`
  }
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
  // Today's quests, as a checkbox and a count: ticked once they're all done.
  if (fit === 'full' && v.quests && v.quests.of > 0) {
    const qx = width + 7
    const all = v.quests.done >= v.quests.of
    const count = `${v.quests.done}/${v.quests.of}`
    svg +=
      grid4(all ? QUEST_DONE : QUEST_BOX, all ? TONES.ok : MUTED, '#', qx, ty + 1.7) +
      `<path d="${textPixels(count, qx + 8.6, ty)}" fill="${MUTED}"/>`
    width = qx + 8.6 + textWidth(count)
  }
  return { svg: `<g transform="translate(${n2(x)} 0)">${svg}</g>`, width: Math.round(width) }
}

const QUEST_BOX = ['#####', '#...#', '#...#', '#...#', '#####']
const QUEST_DONE = ['#####', '#####', '#####', '#####', '#####']

// A badge as a pixel medal: a ribbon over a disc with a star; grey until it's earned.
const MEDAL_PX = ['.##.##.', '.##.##.', '..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..']
const MEDAL_STAR = ['', '', '', '', '...#...', '..###..', '...#...']
const LOCKED = '#3a3f47'

/** One badge medal, `scale` screen pixels per unit; 7 by 9 units. */
function medalSvg(earned: boolean, scale: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${7 * scale}" height="${9 * scale}" viewBox="0 0 7 9" shape-rendering="crispEdges">
  <path d="${pixels(MEDAL_PX.slice(0, 2), 0, 0, 1)}" fill="${earned ? COLORS.flameOut : LOCKED}"/>
  <path d="${pixels(['', '', ...MEDAL_PX.slice(2)], 0, 0, 1)}" fill="${earned ? COLORS.coin : LOCKED}"/>
  ${earned ? `<path d="${pixels(MEDAL_STAR, 0, 0, 1)}" fill="#fff5d6"/>` : ''}
</svg>`
}

const CARD_W = 300
const CARD_H = 170
const CARD_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

/** A short date for the card and the panes: `Sep 29`. */
function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return y ? `${names[(m ?? 1) - 1]} ${d ?? 1}` : day
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * The share card: the week's figures beside Clawd in his outfit, 300 by 170 units drawn at
 * `scale`. Static (no SMIL), so a rasterizer draws it the same as a browser. `isLive` says
 * the week isn't over yet.
 */
function cardSvg(r: Recap, outfit: Record<string, string>, scale = 2, isLive = false): string {
  const ink = '#e6e6e6'
  const dim = '#8b9099'
  const text = (s: string, x: number, y: number, size: number, fill: string, extra = '') =>
    `<text x="${x}" y="${y}" fill="${fill}" style="font: ${size}px ${CARD_FONT}"${extra}>${escapeXml(s)}</text>`
  const level = r.levelTo > r.levelFrom ? `Lv ${r.levelFrom} → ${r.levelTo}` : `Lv ${r.levelTo}`
  // Four short rows, each under 26 characters so none runs off the card.
  const rows = [
    `${r.streak}-day streak${r.days ? ` · ${r.days}/7 days` : ''}`,
    r.scored ? `${r.paced} of ${r.scored} window${r.scored === 1 ? '' : 's'} well paced` : 'no 5-hour window scored yet',
    `${r.turns.toLocaleString('en-US')} turn${r.turns === 1 ? '' : 's'} · ${tokens(r.tokensOut)} tokens`,
    `+${r.xp.toLocaleString('en-US')} XP · +${r.coinsEarned.toLocaleString('en-US')} coins`,
  ]
  const medals = r.badges
    .slice(0, 6)
    .map((_, i) => `<g transform="translate(${16 + i * 11} 142) scale(1.1)">${medalSvg(true, 1).replace(/<\/?svg[^>]*>/g, '')}</g>`)
    .join('')
  const when = isLive ? `week of ${shortDate(r.start)} · so far` : `week of ${shortDate(r.start)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W * scale}" height="${CARD_H * scale}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect x="0.5" y="0.5" width="${CARD_W - 1}" height="${CARD_H - 1}" rx="12" fill="#171717" stroke="#333"/>
  ${text(when, 16, 24, 9, CLAWD)}
  ${text('usage-hud', CARD_W - 16, 24, 9, dim, ' text-anchor="end"')}
  <g transform="translate(10 40) scale(2.6)" shape-rendering="crispEdges">${clawdSvg('happy', 'idle', outfit, false, false)}</g>
  <g transform="translate(140 0)">
    <path d="${textPixels(level.replace(' → ', '-').replace('Lv ', 'Lv'), 0, 46, 3.2)}" fill="${COLORS.level}" shape-rendering="crispEdges"/>
    ${text(titleOf(r.levelTo), 0, 76, 10, dim)}
    ${rows.map((row, i) => text(row, 0, 94 + i * 14, 9.5, i === 3 ? dim : ink)).join('\n    ')}
  </g>
  ${medals}
  ${text(r.badges.length ? `${r.badges.length} badge${r.badges.length === 1 ? '' : 's'} earned` : 'bragging rights, not proof', r.badges.length ? 16 + Math.min(6, r.badges.length) * 11 + 4 : 16, 151, 8, dim)}
  ${r.badges.length ? text('bragging rights, not proof', CARD_W - 16, 151, 8, dim, ' text-anchor="end"') : ''}
</svg>`
}

const grid4 = (g: string[], fill: string, ch: string, x: number, y: number) =>
  `<path d="${pixels(g, x, y, 1.4, ch)}" fill="${fill}"/>`

/** Clawd alone in an outfit, for the shop: `scale` screen pixels per unit. */
function wardrobeSvg(outfit: Record<string, string>, scale: number): string {
  const w = 44
  const h = 28
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="-2 -2 ${w} ${h}" shape-rendering="crispEdges">
  ${clawdSvg('happy', 'idle', outfit, false, false)}
</svg>`
}

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
  maxedSession: 60, // the moment a 5-hour window reaches 100%
  maxedWeek: 150, // the moment a weekly window does
  badge: 50,
}

const COINS = {
  perTokens: 1000, // one coin per this many tokens Claude writes
  level: 100,
  badge: 25,
}

const BADGES: Record<string, { name: string; how: string }> = {
  'first-steps': { name: 'First Steps', how: 'your first turn with Clawd' },
  'on-a-roll': { name: 'On a Roll', how: 'a 7-day streak' },
  unstoppable: { name: 'Unstoppable', how: 'a 30-day streak' },
  'close-call': { name: 'Close Call', how: 'a week that peaked at 95–99%' },
  zen: { name: 'Zen', how: 'a week that stayed under 50%' },
  'perfect-pace': { name: 'Perfect Pace', how: 'three well-paced 5-hour windows in a row' },
  'maxed-out': { name: 'Maxed Out', how: 'a limit taken all the way to 100%' },
  phoenix: { name: 'Phoenix', how: 'back at it after a limit you hit reset' },
  marathon: { name: 'Marathon', how: '100 tool calls in one session' },
  'deep-thinker': { name: 'Deep Thinker', how: 'context past 80%' },
  'fresh-start': { name: 'Fresh Start', how: 'a busy context cleared' },
  'night-owl': { name: 'Night Owl', how: 'a turn between 2 and 5am' },
  'early-bird': { name: 'Early Bird', how: 'a turn between 5 and 7am' },
  delegator: { name: 'Delegator', how: '10 subagent turns in one session' },
  scholar: { name: 'Scholar', how: '50 web searches' },
  'clean-exit': { name: 'Clean Exit', how: '50 turns in a session that never passed 60% context' },
  comeback: { name: 'Comeback', how: 'back after two weeks away' },
  'pumpkin-patch': { name: 'Pumpkin Patch', how: 'a turn in Halloween week, Oct 25 to 31' },
}

function newProgress(): Progress {
  return {
    xp: 0,
    turns: 0,
    tokensIn: 0,
    tokensOut: 0,
    streak: { count: 0, best: 0, restDays: 0 },
    badges: {},
    today: freshToday(''),
    searches: 0,
    windows: {},
    paced: 0,
    phoenix: false,
    coins: 0,
    coinTokens: 0,
    owned: [],
    outfit: {},
    quests: {},
  }
}

const freshToday = (day: string): Today => ({ day, turns: 0, tokensOut: 0, toolCalls: 0, tools: [], searches: 0, clears: 0, steady: 0 })

/** The saved progress, with any field an older version didn't keep filled in, one level down too. */
function progressOf(saved: unknown): Progress {
  const base = newProgress()
  if (!saved || typeof saved !== 'object') return base
  const old = saved as Partial<Progress>
  return {
    ...base,
    ...old,
    streak: { ...base.streak, ...old.streak },
    today: { ...base.today, ...old.today },
    quests: old.quests ?? {},
  }
}

/** A change to the progress, the toasts it calls for, and a command's answer. */
type Step = { p: Progress; news: string[]; reply?: string }

const stepFrom = (p: Progress): Step => ({ p: JSON.parse(JSON.stringify(p)), news: [] })

function earn(step: Step, id: string, day: string) {
  if (step.p.badges[id] || !BADGES[id]) return
  step.p.badges[id] = day
  step.p.xp += XP.badge
  step.p.coins += COINS.badge
  step.news.push(`Badge earned: ${BADGES[id].name}, ${BADGES[id].how} (+${XP.badge} XP, +${COINS.badge} coins)`)
}

type TurnFacts = {
  now: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
  /** Tool calls so far this session, main conversation only. */
  tools: number
  /** Since the last turn: the tools called, how many calls, and how many were web searches or fetches. */
  recent?: { tools: string[]; calls: number; searches: number }
  /** This session so far: subagent turns, main turns before this one, and the highest context figure. */
  session?: { subagents: number; turns: number; ctxPeak: number }
}

function afterTurn(prev: Progress, t: TurnFacts): Step {
  const step = stepFrom(prev)
  const p = step.p
  const day = begin(step, t.now)
  p.turns += 1
  if (t.usage) {
    p.tokensIn += t.usage.input_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens
    p.tokensOut += t.usage.output_tokens
    p.today.tokensOut += t.usage.output_tokens
    // Written tokens become coins, a thousand at a time; the rest waits for the next turn.
    p.coinTokens += t.usage.output_tokens
    const coins = Math.floor(p.coinTokens / COINS.perTokens)
    p.coins += coins
    p.coinTokens -= coins * COINS.perTokens
  }
  if (t.recent) {
    p.today.toolCalls += t.recent.calls
    p.today.searches += t.recent.searches
    p.searches += t.recent.searches
    for (const name of t.recent.tools) if (!p.today.tools.includes(name) && p.today.tools.length < 100) p.today.tools.push(name)
  }

  // The first turn of a day carries the streak on, spending rest days on any days missed.
  const s = p.streak
  const gap = s.lastDay ? daysBetween(s.lastDay, day) : 1
  const away = s.lastDay ? gap - 1 : 0
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
    if (p.week) p.week.days += 1
  }
  if (p.week) p.week.streak = Math.max(p.week.streak, s.count)

  p.xp += p.today.turns < XP.turnsBeforeTired ? XP.turn : XP.tiredTurn
  p.today.turns += 1

  const at = new Date(t.now)
  const hour = at.getHours()
  earn(step, 'first-steps', day)
  if (s.count >= 7) earn(step, 'on-a-roll', day)
  if (s.count >= 30) earn(step, 'unstoppable', day)
  if (hour >= 2 && hour < 5) earn(step, 'night-owl', day)
  if (hour >= 5 && hour < 7) earn(step, 'early-bird', day)
  if (t.tools >= 100) earn(step, 'marathon', day)
  if (away >= 14) earn(step, 'comeback', day)
  if (p.searches >= 50) earn(step, 'scholar', day)
  if (t.session && t.session.subagents >= 10) earn(step, 'delegator', day)
  if (t.session && t.session.turns + 1 >= 50 && t.session.ctxPeak < 60) earn(step, 'clean-exit', day)
  if (at.getMonth() === 9 && at.getDate() >= 25) earn(step, 'pumpkin-patch', day)
  if (p.phoenix) {
    earn(step, 'phoenix', day)
    p.phoenix = false
  }
  checkQuests(step, day)
  return step
}

// #region weeks: the calendar week, rolled over on the first change of the next

/** The Monday of the week holding `day`, as `YYYY-MM-DD`. */
function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** What the week has come to so far, in the recap's shape. */
function weekSoFar(p: Progress, w: Week, end: string): Recap {
  return {
    start: w.start,
    turns: p.turns - w.turns,
    tokensOut: p.tokensOut - w.tokensOut,
    xp: Math.max(0, Math.floor(p.xp - w.xp)),
    levelFrom: levelOf(w.xp),
    levelTo: levelOf(p.xp),
    coinsEarned: Math.max(0, p.coins - w.coins + w.spent),
    coinsSpent: w.spent,
    scored: w.scored,
    paced: w.paced,
    streak: w.streak,
    days: w.days,
    badges: Object.entries(p.badges)
      .filter(([, d]) => d >= w.start && d < end)
      .map(([id]) => id),
  }
}

// Every turn and reading starts here: a new day gets fresh counters, and a new week files
// the old one as the recap (when anything happened in it) and starts counting again.
function begin(step: Step, now: number): string {
  const p = step.p
  const day = dayOf(now)
  if (p.today.day !== day) {
    p.today = freshToday(day)
    for (const [key, done] of Object.entries(p.quests)) if (daysBetween(done, day) > 14) delete p.quests[key]
  }
  const start = weekStartOf(day)
  if (p.week?.start !== start) {
    if (p.week && p.turns > p.week.turns) {
      p.recap = weekSoFar(p, p.week, start)
      step.news.push('Your week in review is ready: press "Week in review" on the band, or /usage-hud recap')
    }
    p.week = { start, xp: p.xp, coins: p.coins, turns: p.turns, tokensOut: p.tokensOut, spent: 0, scored: 0, paced: 0, streak: liveStreak(p, now), days: 0 }
  }
  return day
}

/** The recap to show: last week's until it's been seen, else this week so far. */
function recapOf(p: Progress, now: number): { recap: Recap; isLive: boolean } | undefined {
  if (p.recap && p.recapSeen !== p.recap.start) return { recap: p.recap, isLive: false }
  if (p.week) return { recap: weekSoFar(p, p.week, dayOf(now + 86_400_000)), isLive: true }
  return undefined
}

const recapDue = (p: Progress) => p.recap !== undefined && p.recapSeen !== p.recap.start

function sawRecap(prev: Progress): Step {
  const step = stepFrom(prev)
  if (step.p.recap) step.p.recapSeen = step.p.recap.start
  return step
}

// #endregion weeks

// #region quests: three a day and one a week, the same for everyone, picked from the date

type Quest = { id: string; text: string; goal: number; coins: number; unit?: string; of: (p: Progress) => number }

const DAILY_QUESTS: Quest[] = [
  { id: 'tools', text: 'Use three different tools', goal: 3, coins: 20, unit: 'tools', of: p => p.today.tools.length },
  { id: 'steady', text: 'Finish a 5-hour window between 40 and 70%', goal: 1, coins: 40, unit: 'window', of: p => p.today.steady },
  { id: 'clear', text: 'Clear the context before it passes 60%', goal: 1, coins: 20, unit: 'clear', of: p => p.today.clears },
  { id: 'write', text: 'Have Claude write 20k tokens', goal: 20_000, coins: 30, unit: 'tokens', of: p => p.today.tokensOut },
  { id: 'turns', text: 'Take 15 turns', goal: 15, coins: 20, unit: 'turns', of: p => p.today.turns },
  { id: 'calls', text: 'Make 30 tool calls', goal: 30, coins: 20, unit: 'calls', of: p => p.today.toolCalls },
  { id: 'search', text: 'Search the web twice', goal: 2, coins: 20, unit: 'searches', of: p => p.today.searches },
]

const WEEKLY_QUESTS: Quest[] = [
  { id: 'paced', text: 'Five well-paced 5-hour windows this week', goal: 5, coins: 150, unit: 'windows', of: p => p.week?.paced ?? 0 },
  { id: 'days', text: 'A turn on five days this week', goal: 5, coins: 150, unit: 'days', of: p => p.week?.days ?? 0 },
  { id: 'write', text: 'Have Claude write 150k tokens this week', goal: 150_000, coins: 150, unit: 'tokens', of: p => (p.week ? p.tokensOut - p.week.tokensOut : 0) },
]

/** A small stable hash of a string (FNV-1a), the seed the date gives. */
function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

/** `n` of the pool in a seeded order, so a day's quests are the same on every machine. */
function pickOf<T>(pool: T[], n: number, seed: number): T[] {
  const list = [...pool]
  let x = seed || 1
  for (let i = list.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    const j = x % (i + 1)
    ;[list[i], list[j]] = [list[j]!, list[i]!]
  }
  return list.slice(0, n)
}

type Active = { quest: Quest; key: string; isWeekly: boolean }

/** Today's three quests and the week's one, keyed as the done list keeps them. */
function questsFor(day: string): Active[] {
  const start = weekStartOf(day)
  const daily = pickOf(DAILY_QUESTS, 3, hashOf(`day:${day}`)).map(quest => ({ quest, key: `${day}:${quest.id}`, isWeekly: false }))
  const weekly = pickOf(WEEKLY_QUESTS, 1, hashOf(`week:${start}`)).map(quest => ({ quest, key: `w${start}:${quest.id}`, isWeekly: true }))
  return [...daily, ...weekly]
}

type QuestView = Active & { at: number; isDone: boolean }

/** Each active quest with how far along it is; counters from another day or week read as zero. */
function questViews(p: Progress, day: string): QuestView[] {
  const sameWeek = p.week?.start === weekStartOf(day)
  return questsFor(day).map(a => {
    const isDone = p.quests[a.key] !== undefined
    const counted = a.isWeekly ? sameWeek : p.today.day === day
    const at = isDone ? a.quest.goal : counted ? Math.min(a.quest.goal, a.quest.of(p)) : 0
    return { ...a, at, isDone }
  })
}

/** Pays out any quest that has just been met. */
function checkQuests(step: Step, day: string) {
  for (const v of questViews(step.p, day)) {
    if (v.isDone || v.at < v.quest.goal) continue
    step.p.quests[v.key] = day
    step.p.coins += v.quest.coins
    step.news.push(`Quest done: ${v.quest.text} (+${v.quest.coins} coins)`)
  }
}

/** The band's count: today's quests done, of three. */
function questSummary(p: Progress, day: string): { done: number; of: number } {
  const daily = questViews(p, day).filter(v => !v.isWeekly)
  return { done: daily.filter(v => v.isDone).length, of: daily.length }
}

/** Until the quests change: the time to local midnight. */
function untilMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime() - now
}

const questLine = (v: QuestView) => {
  const progress = v.isDone ? 'done' : v.quest.goal > 1 ? `${v.at.toLocaleString('en-US')} of ${v.quest.goal.toLocaleString('en-US')}` : 'not yet'
  return `${v.isDone ? '☑' : '☐'} ${v.quest.text} · ${progress} · +${v.quest.coins} coins`
}

function questsOf(p: Progress, now: number): string {
  const day = dayOf(now)
  const views = questViews(p, day)
  const done = views.filter(v => v.isDone).length
  return [
    `Quests · ${done} of ${views.length} done · new ones in ${untilReset(untilMidnight(now))} · the same for everyone today`,
    ...views.map(questLine),
  ].join('\n')
}

// #endregion quests

// #region trophies: every badge, earned or how far along it is

type SessionFacts = { tools: number; subagents: number; turns: number; ctxPeak: number }
type BadgeView = { id: string; name: string; how: string; earned?: string; progress?: { at: number; of: number; unit: string }; note?: string }

/** The trophy case: each badge with the day it was earned, or how far along it is. */
function badgeViews(p: Progress, now: number, session: SessionFacts): BadgeView[] {
  const streak = liveStreak(p, now)
  const weekPeak = p.windows.seven_day?.peak
  const toward = (at: number, of: number, unit: string) => ({ at: Math.min(of, Math.max(0, Math.floor(at))), of, unit })
  const detail: Record<string, Pick<BadgeView, 'progress' | 'note'>> = {
    'on-a-roll': { progress: toward(streak, 7, 'days') },
    unstoppable: { progress: toward(streak, 30, 'days') },
    'perfect-pace': { progress: toward(p.paced, 3, 'windows') },
    marathon: { progress: toward(session.tools, 100, 'calls this session') },
    'deep-thinker': { progress: toward(session.ctxPeak, 80, '% context this session') },
    delegator: { progress: toward(session.subagents, 10, 'subagent turns this session') },
    scholar: { progress: toward(p.searches, 50, 'searches') },
    'clean-exit': session.ctxPeak >= 60 ? { note: 'context passed 60% this session; try the next one' } : { progress: toward(session.turns, 50, 'turns this session') },
    'close-call': weekPeak === undefined ? {} : { note: `this week has peaked at ${Math.round(weekPeak)}%` },
    zen: weekPeak === undefined ? {} : { note: `this week has peaked at ${Math.round(weekPeak)}%` },
    'pumpkin-patch': { note: 'Oct 25 to 31' },
  }
  return Object.entries(BADGES).map(([id, b]) => ({ id, ...b, earned: p.badges[id], ...(p.badges[id] ? {} : detail[id]) }))
}

function badgesOf(p: Progress, now: number, session: SessionFacts): string {
  const views = badgeViews(p, now, session)
  const earned = views.filter(v => v.earned).length
  const line = (v: BadgeView) => {
    const state = v.earned
      ? `earned ${shortDate(v.earned)}`
      : v.progress
        ? `${bar((v.progress.at / v.progress.of) * 100, 6)} ${v.progress.at.toLocaleString('en-US')} of ${v.progress.of} ${v.progress.unit}`
        : (v.note ?? 'not yet')
    return `${v.earned ? '★' : '☆'} ${v.name} · ${v.how} · ${state}`
  }
  return [`Badges · ${earned} of ${views.length} · each worth ${XP.badge} XP and ${COINS.badge} coins`, ...views.map(line)].join('\n')
}

// #endregion trophies

function maxedOut(step: Step, kind: string, day: string) {
  const gain = kind === 'seven_day' ? XP.maxedWeek : kind === 'five_hour' ? XP.maxedSession : 0
  if (gain === 0) return
  step.p.xp += gain
  step.news.push(`Maxed out the ${kind === 'seven_day' ? 'weekly' : 'session'} limit! (+${gain} XP)`)
  earn(step, 'maxed-out', day)
}

// A window has ended: score how it went.
function scoreWindow(step: Step, kind: string, peak: number, day: string) {
  const p = step.p
  if (peak >= 100) p.phoenix = true
  if (kind === 'five_hour') {
    if (p.week) p.week.scored += 1
    if (peak >= 40 && peak <= 70) p.today.steady += 1
    if (peak >= 60 && peak < 100) {
      p.xp += XP.paced
      p.paced += 1
      if (p.week) p.week.paced += 1
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
  const day = begin(step, now)
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
    // Reaching 100% pays out at once, once per window.
    if (l.pct >= 100 && from < 100) maxedOut(step, l.kind, day)
    p.windows[l.kind] = { resetsAt: l.resetsAt ?? w.resetsAt, peak: Math.max(from, l.pct) }
  }
  if (snap.ctxPct >= 80) earn(step, 'deep-thinker', day)
  if (prevCtx !== undefined && prevCtx > 50 && snap.ctxPct < 10) earn(step, 'fresh-start', day)
  // A context cleared while it still had room: the figure drops from somewhere under 60% to near nothing.
  if (prevCtx !== undefined && prevCtx >= 20 && prevCtx < 60 && snap.ctxPct < 10) p.today.clears += 1
  checkQuests(step, day)
  return step
}

function statsOf(p: Progress, now: number): string {
  const level = levelOf(p.xp)
  const xp = Math.floor(p.xp)
  const outfit = outfitOf(p, level)
  const worn = SLOTS.flatMap(slot => (outfit[slot] ? [nameOf(outfit[slot])] : []))
  const all = Object.entries(BADGES)
  const earned = all.filter(([id]) => p.badges[id]).map(([, b]) => b.name)
  const left = all.filter(([id]) => !p.badges[id]).map(([, b]) => `${b.name} (${b.how})`)
  const streak = liveStreak(p, now)
  const next = LEVELS.find(m => m.at > level)
  return [
    `Clawd · level ${level}, ${titleOf(level)} · ${xp.toLocaleString('en-US')} XP, ${(xpFor(level + 1) - xp).toLocaleString('en-US')} to level ${level + 1}`,
    `Streak: ${streak} day${streak === 1 ? '' : 's'} (best ${p.streak.best}) · ${p.streak.restDays} rest day${p.streak.restDays === 1 ? '' : 's'} saved`,
    `Turns: ${p.turns.toLocaleString('en-US')} · tokens: ${tokens(p.tokensIn)} in, ${tokens(p.tokensOut)} out`,
    `Coins: ${p.coins.toLocaleString('en-US')} · wearing: ${worn.join(', ') || 'nothing'} (/usage-hud shop)`,
    next ? `Next: ${next.title === titleOf(level) ? '' : `${next.title}, `}${next.item ? nameOf(next.item) : ''} at level ${next.at}` : '',
    `Badges ${earned.length}/${all.length}: ${earned.join(', ') || 'none yet'} (/usage-hud badges)`,
    left.length ? `Still to earn: ${left.join('; ')}` : '',
    `Quests today: ${questSummary(p, dayOf(now)).done}/3 done (/usage-hud quests)${recapDue(p) ? ' · your week in review is ready (/usage-hud recap)' : ''}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The item an argument names, by id or by name (`hard hat`, `the crown`); `none` for everything. */
function itemNamed(arg: string): string | undefined {
  const want = arg.trim().toLowerCase().replace(/^the\s+/, '')
  if (want === 'none' || want === 'nothing' || want === 'all' || want === 'everything') return 'none'
  return Object.keys(ITEMS).find(id => id === want || ITEMS[id]?.name === want)
}

const unlockLevel = (id: string) => LEVELS.find(m => m.item === id)?.at

function shopOf(p: Progress): string {
  const level = levelOf(p.xp)
  const worn = outfitOf(p, level)
  const line = (slot: Slot) =>
    Object.entries(ITEMS)
      .filter(([, item]) => item.slot === slot)
      .map(([id, item]) => {
        const cost = item.price ? `${item.price.toLocaleString('en-US')}` : `free at level ${unlockLevel(id)}`
        const mark = worn[slot] === id ? ' (wearing)' : owns(p, level, id) ? ' ✓' : item.level && level < item.level ? ` (needs level ${item.level})` : ''
        return `${item.name} ${cost}${mark}`
      })
      .join(' · ')
  return [
    `Shop · you have ${p.coins.toLocaleString('en-US')} coins (1 per ${COINS.perTokens.toLocaleString('en-US')} tokens Claude writes, ${COINS.level} per level-up, ${COINS.badge} per badge)`,
    ...SLOTS.map(slot => `${slot[0]?.toUpperCase()}${slot.slice(1)}: ${line(slot)}`),
    `/usage-hud buy <item> to buy · wear <item> or remove <item> to change outfits · wear none to take it all off`,
  ].join('\n')
}

function bought(prev: Progress, arg: string): Step {
  const step = stepFrom(prev)
  const p = step.p
  const level = levelOf(p.xp)
  const id = itemNamed(arg)
  const item = id ? ITEMS[id] : undefined
  if (!id || !item) step.reply = `There's no "${arg}" in the shop. /usage-hud shop lists everything.`
  else if (!item.price) step.reply = `The ${item.name} isn't for sale: it comes free at level ${unlockLevel(id)}.`
  else if (owns(p, level, id)) step.reply = `You already have the ${item.name}. /usage-hud wear ${id} puts it on.`
  else if (item.level && level < item.level) step.reply = `The ${item.name} needs level ${item.level}, and Clawd is level ${level}.`
  else if (p.coins < item.price) step.reply = `The ${item.name} costs ${item.price.toLocaleString('en-US')} coins and you have ${p.coins.toLocaleString('en-US')}.`
  else {
    p.coins -= item.price
    if (p.week) p.week.spent += item.price
    p.owned.push(id)
    p.outfit[item.slot] = id
    step.reply = `Bought the ${item.name} for ${item.price.toLocaleString('en-US')} coins, and Clawd's wearing it. ${p.coins.toLocaleString('en-US')} coins left.`
  }
  return step
}

function dressed(prev: Progress, arg: string): Step {
  const step = stepFrom(prev)
  const p = step.p
  const level = levelOf(p.xp)
  const id = itemNamed(arg)
  const item = id ? ITEMS[id] : undefined
  if (id === 'none') {
    for (const slot of SLOTS) p.outfit[slot] = 'none'
    step.reply = 'Clawd took everything off.'
  } else if (!id || !item) {
    const mine = Object.keys(ITEMS).filter(i => owns(p, level, i)).map(nameOf)
    step.reply = `Clawd can wear: ${mine.join(', ') || 'nothing yet'}. /usage-hud shop has more.`
  } else if (!owns(p, level, id)) {
    step.reply = item.price
      ? `Clawd doesn't have the ${item.name} yet: it's ${item.price.toLocaleString('en-US')} coins in /usage-hud shop.`
      : `The ${item.name} unlocks at level ${unlockLevel(id)}.`
  } else {
    p.outfit[item.slot] = id
    step.reply = `Clawd is wearing the ${item.name}.`
  }
  return step
}

function undressed(prev: Progress, arg: string): Step {
  const step = stepFrom(prev)
  const p = step.p
  const want = arg.trim().toLowerCase()
  const id = itemNamed(want)
  const slot = SLOTS.find(s => s === want) ?? (id && id !== 'none' ? ITEMS[id]?.slot : undefined)
  const on = slot ? outfitOf(p, levelOf(p.xp))[slot] : undefined
  if (!slot || !on || (id && id !== 'none' && id !== on)) {
    step.reply = `Clawd isn't wearing that. /usage-hud stats shows what he has on.`
  } else {
    p.outfit[slot] = 'none'
    step.reply = `Took off the ${nameOf(on)}.`
  }
  return step
}
/** One item on the shop's shelf, and what a press on it does: take off, put on, buy, or nothing yet. */
type Shelf = { id: string; name: string; slot: Slot; state: 'wearing' | 'owned' | 'buy' | 'short' | 'locked'; price?: number; level?: number }

function shelfOf(p: Progress): Shelf[] {
  const level = levelOf(p.xp)
  const worn = outfitOf(p, level)
  return Object.entries(ITEMS).map(([id, item]): Shelf => {
    const shelf = { id, name: item.name, slot: item.slot, price: item.price }
    if (worn[item.slot] === id) return { ...shelf, state: 'wearing' }
    if (owns(p, level, id)) return { ...shelf, state: 'owned' }
    if (!item.price) return { ...shelf, state: 'locked', level: unlockLevel(id) }
    if (item.level && level < item.level) return { ...shelf, state: 'locked', level: item.level }
    return { ...shelf, state: p.coins < item.price ? 'short' : 'buy' }
  })
}

/** What a press on an item does, as the text command would: `wear`, `remove` or `buy`. */
const pressOf = (s: Shelf) => (s.state === 'wearing' ? undressed : s.state === 'owned' ? dressed : s.state === 'buy' ? bought : undefined)
// #endregion game

// #region versions: pure, no $
const REPO = 'lucassimzq/claude-usage-mod'
const CHECK_EVERY_MS = 6 * 3_600_000 // GitHub allows 60 unauthenticated calls an hour

/** `v1.2.3` or `1.2.3` as numbers; anything else (a pre-release, a stray tag) is not a release. */
function versionOf(tag: string): number[] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

function isNewer(a: string, b: string): boolean {
  const x = versionOf(a)
  const y = versionOf(b)
  if (!x || !y) return false
  const i = x.findIndex((n, k) => n !== y[k])
  return i >= 0 && x[i]! > y[i]!
}

function highestTag(names: string[]): string | undefined {
  return names.filter(n => versionOf(n)).reduce<string | undefined>((best, n) => (!best || isNewer(n, best) ? n : best), undefined)
}

const plainVersion = (tag: string) => tag.replace(/^v/, '')
// #endregion versions

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
const HIDDEN = 'hidden' // true while the person has hidden the band, across sessions
let playing: Promise<unknown> = Promise.resolve()
let sparkle: { cancel: () => void } | undefined

// Applies one change to Clawd's progress, one change at a time: read fresh from the
// store (another session may have moved it on), changed, saved, drawn, announced.
async function play($: EngineInterface, change: (p: Progress, now: number) => Step): Promise<string | undefined> {
  const run = playing.then(async () => {
    const now = await $.clock.now()
    const before = progressOf(await $.store.get(PROGRESS))
    const { p, news, reply } = change(before, now)
    const was = levelOf(before.xp)
    const is = levelOf(p.xp)
    p.coins += COINS.level * Math.max(0, is - was)
    await $.store.set(PROGRESS, p)
    await update($, game, (g: Game) => ({ progress: p, burst: is > was || g.burst }))
    if (is > was) {
      const unlock = LEVELS.filter(m => m.at > was && m.at <= is && m.item).pop()?.item
      $.ui.toast(
        `Clawd reached level ${is}: ${titleOf(is)}${unlock ? `, ${nameOf(unlock)} unlocked` : ''} (+${COINS.level * (is - was)} coins)`,
      )
      sparkle?.cancel()
      sparkle = $.clock.after(2600, () => {
        void update($, game, (g: Game) => ({ ...g, burst: false }))
      })
    }
    for (const line of news) $.ui.toast(line)
    return reply
  })
  // A failed change is dropped so the game never gets in the way of the band; the debug log says so.
  const settled = run.catch((err: unknown) => {
    $.ui.log(`a progress change was dropped: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    return undefined
  })
  playing = settled
  return settled
}

// This session's own counts, for the badges and quests that are about one session or one turn.
let toolCalls = 0
let subTurns = 0
let mainTurns = 0
let ctxPeak = 0
let lastCtx: number | undefined
// Since the last main turn finished: which tools were called, how often, and how many searched the web.
let recent = { tools: new Set<string>(), calls: 0, searches: 0 }

const sessionFacts = () => ({ tools: toolCalls, subagents: subTurns, turns: mainTurns, ctxPeak })

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
  ctxPeak = Math.max(ctxPeak, snap.ctxPct)
  await play($, (p, now) => afterMeasure(p, snap, now, prevCtx))
}

// Re-reads the figures now: the countdowns and pace marks move at once; the
// limits themselves change only when a response has reported new ones.
async function refresh($: EngineInterface) {
  await take($, snapshotOf(await $.session.usage()))
  $.ui.toast('Usage refreshed', { timeoutMs: 1500 })
}

// The version this module was loaded from; a reload reads it again.
let running = '0.0.0'
let restartHint: { cancel: () => void } | undefined
const LATEST = 'latest' // { tag, checkedAt }: the last answer from GitHub, shared by every session
const INSTALLING = 'installing' // the tag a press last installed, so the reloaded mod can say so

// Asks GitHub for the newest release tag at most every few hours (any session's answer
// counts), and marks the band when it's newer than what's running.
async function checkForUpdate($: EngineInterface, isForced = false): Promise<string | undefined> {
  const now = await $.clock.now()
  const saved = (await $.store.get(LATEST)) as { tag?: string; checkedAt?: number } | undefined
  let tag = saved?.tag
  const isDue = isForced || !saved?.checkedAt || now - saved.checkedAt >= CHECK_EVERY_MS
  if (isDue && !(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))) {
    try {
      const res = await $.http.fetch(`https://api.github.com/repos/${REPO}/tags?per_page=100`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'usage-hud' },
      })
      if (res.ok) {
        const list = JSON.parse(res.text) as { name: string }[]
        tag = highestTag(list.map(t => t.name))
      }
      // Any answer counts as a check (a 403 from the rate limit too), so GitHub isn't asked again for hours.
      await $.store.set(LATEST, { tag, checkedAt: now })
    } catch {
      // Offline or refused: keep what we knew and try again on the next check.
    }
  }
  const latest = tag && isNewer(tag, running) ? tag : undefined
  await update($, updates, (u: Update): Update => ({ ...u, current: running, latest }))
  return latest
}

// Brings the clone up to the newest release tag with git. The folder is watched, so in
// most sessions the mod reloads itself a moment later and this module is replaced; if
// it's still here after that, the session doesn't watch the folder and needs a restart.
async function installUpdate($: EngineInterface): Promise<string> {
  const { latest, phase } = await read($, updates)
  if (!latest) return `usage-hud is up to date (v${running}).`
  if (phase !== 'idle') return `usage-hud ${latest} is already ${phase === 'installing' ? 'being installed' : 'installed; restart Claude Code to load it'}.`
  const root = $.plugin.root
  // No prompt for credentials: a remote that asks for them fails at once instead of hanging until the timeout.
  const git = (...args: string[]) =>
    $.process.run(['git', '-C', root, ...args], { timeoutMs: 60_000, env: { GIT_TERMINAL_PROMPT: '0' } })
  const manual = `Run \`git -C ${root} pull\` to update by hand.`
  try {
    const clone = await git('rev-parse', '--is-inside-work-tree')
    if (clone.exitCode !== 0) return `usage-hud ${latest} is out, but this copy isn't a git clone. Update it the way you installed it.`
    await update($, updates, (u: Update): Update => ({ ...u, phase: 'installing' }))
    // Just the one tag: nothing else the remote holds is fetched, and a stray tag elsewhere can't fail the update.
    const fetched = await git('fetch', '--quiet', '--no-tags', 'origin', 'tag', latest)
    const result = fetched.exitCode === 0 ? await git('merge', '--ff-only', '--quiet', `refs/tags/${latest}`) : fetched
    if (result.exitCode !== 0) {
      await update($, updates, (u: Update): Update => ({ ...u, phase: 'idle' }))
      const why = result.stderr.trim().split('\n')[0] || `git exited with ${result.exitCode}`
      return `Couldn't update usage-hud: ${why}. ${manual}`
    }
    await $.store.set(INSTALLING, latest)
    restartHint?.cancel()
    restartHint = $.clock.after(8000, () => {
      void update($, updates, (u: Update): Update => ({ ...u, phase: 'restart' }))
      $.ui.toast(`usage-hud ${latest} is installed. Restart Claude Code to load it.`)
    })
    return `Installing usage-hud ${latest}…`
  } catch {
    await update($, updates, (u: Update): Update => ({ ...u, phase: 'idle' }))
    return `Couldn't run git here. ${manual}`
  }
}

// Writes only on a change, since a response streams many chunks of the same kind.
let doing: Activity = 'idle'

const SHOP = 'shop'
const SHOP_WIDE = 420 // px: below this the shop's header stacks under Clawd
const SLOT_NAMES: Record<Slot, string> = { head: 'Head', face: 'Face', neck: 'Neck', back: 'Back', shell: 'Shell', buddy: 'Buddy' }

// Opens the shop pane where the person asked for it; the text list stands in where it can't be drawn.
async function openShop($: EngineInterface): Promise<string> {
  const opened = await $.ui.open({ id: SHOP, title: "Clawd's shop", focus: true, closeOnEscape: true, rows: 12 }).catch(() => undefined)
  if (opened?.isPlaced) return "Opened Clawd's shop: pick something to wear, buy or take off. Esc closes it."
  return shopOf(progressOf(await $.store.get(PROGRESS)))
}

// A press in the shop: the same change the text command makes, its answer as a toast.
async function shopPress($: EngineInterface, change: (p: Progress, arg: string) => Step, arg: string) {
  const reply = await play($, p => change(p, arg))
  if (reply) $.ui.toast(reply, { timeoutMs: 3000 })
}

async function setActivity($: EngineInterface, next: Activity) {
  if (next === doing) return
  doing = next
  await update($, activity, () => next)
}

const RECAP = 'recap'
const BADGES_PANE = 'badges'
const QUESTS = 'quests'
const NO_WEEK_YET = 'Nothing to show yet: your first week starts with your next turn.'

// Opens one of the panes where the person asked for it; `fallback` is the same thing as text.
async function openPane($: EngineInterface, id: string, title: string, rows: number, fallback: string): Promise<string> {
  const opened = await $.ui.open({ id, title, focus: true, closeOnEscape: true, rows }).catch(() => undefined)
  if (opened?.isPlaced) return `Opened ${title.toLowerCase()}. Esc closes it.`
  return fallback
}

// A press on Save card: the answer as a toast.
async function savePress($: EngineInterface) {
  $.ui.toast(await saveCard($), { timeoutMs: 6000 })
}

// Marks the recap seen (the band's button goes) and closes its pane.
async function closeRecap($: EngineInterface) {
  await play($, sawRecap)
  await $.ui.close({ id: RECAP }).catch(() => undefined)
}

// Writes the week's card as an SVG in the Downloads folder (or home), and as a PNG where the
// machine can rasterize one. Only this card's figures leave the store, and only to a local file.
async function saveCard($: EngineInterface): Promise<string> {
  const p = progressOf(await $.store.get(PROGRESS))
  const shown = recapOf(p, await $.clock.now())
  if (!shown) return NO_WEEK_YET
  const svg = cardSvg(shown.recap, outfitOf(p, levelOf(p.xp)), 2, shown.isLive)
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (!home) return "Couldn't find your home folder to save the card into."
  const downloads = `${home}/Downloads`
  const dir = (await $.fs.exists(downloads).catch(() => false)) ? downloads : home
  const name = `usage-hud-week-${shown.recap.start}`
  try {
    await $.fs.write(`${dir}/${name}.svg`, svg)
  } catch (err) {
    return `Couldn't save the card: ${err instanceof Error ? err.message : String(err)}`
  }
  const png = await rasterize($, `${dir}/${name}.svg`, `${dir}/${name}.png`, dir)
  const where = dir === downloads ? 'your Downloads folder' : dir
  return png ? `Saved ${name}.png and ${name}.svg to ${where}.` : `Saved ${name}.svg to ${where} (no PNG converter found on this machine).`
}

// A PNG from the SVG with whatever the machine has: rsvg-convert, Quick Look on macOS, or ImageMagick.
async function rasterize($: EngineInterface, svg: string, png: string, dir: string): Promise<boolean> {
  const run = async (argv: string[]) => {
    try {
      return (await $.process.run(argv, { timeoutMs: 20_000 })).exitCode === 0
    } catch {
      return false
    }
  }
  if (await run(['rsvg-convert', '-w', '1200', '-o', png, svg])) return true
  // Quick Look writes `<name>.svg.png` into the folder; move it into place.
  if ((await run(['qlmanage', '-t', '-s', '1200', '-o', dir, svg])) && (await $.fs.exists(`${svg}.png`).catch(() => false))) {
    return run(['mv', '-f', `${svg}.png`, png])
  }
  if (await run(['magick', svg, '-resize', '1200x', png])) return true
  return run(['convert', svg, '-resize', '1200x', png])
}

/** The week as lines of text: the recap's fallback and the pane's detail. */
function recapLines(r: Recap, isLive: boolean): string[] {
  const names = r.badges.map(id => BADGES[id]?.name ?? id)
  return [
    `Week of ${shortDate(r.start)}${isLive ? ', so far' : ''}`,
    `Level ${r.levelFrom === r.levelTo ? r.levelTo : `${r.levelFrom} → ${r.levelTo}`}, ${titleOf(r.levelTo)} · +${r.xp.toLocaleString('en-US')} XP`,
    `Streak: up to ${r.streak} day${r.streak === 1 ? '' : 's'} · active ${r.days} day${r.days === 1 ? '' : 's'}`,
    r.scored ? `Pacing: ${r.paced} of ${r.scored} 5-hour window${r.scored === 1 ? '' : 's'} well paced` : 'Pacing: no 5-hour window finished yet',
    `Turns: ${r.turns.toLocaleString('en-US')} · ${tokens(r.tokensOut)} tokens written`,
    `Coins: +${r.coinsEarned.toLocaleString('en-US')} earned, ${r.coinsSpent.toLocaleString('en-US')} spent`,
    `Badges: ${names.join(', ') || 'none this week'}`,
  ]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-hud',
      description:
        'Show or hide the usage band; `recap` for your week and its share card, `badges` and `quests` for the trophy case and today\'s quests, `stats`, `shop` to spend coins on outfits, `update` to get the newest version',
      argumentHint: '[recap | card | badges | quests | stats | shop | shop list | buy <item> | wear <item> | remove <item> | update]',
    })
    try {
      const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }
      running = manifest.version ?? running
    } catch {
      // No readable manifest: every release counts as newer, which is the safe side.
    }
    // A reload after an update lands here with the new code: say so once.
    const installed = (await $.store.get(INSTALLING)) as string | undefined
    if (installed) {
      await $.store.delete(INSTALLING)
      if (!isNewer(installed, running)) $.ui.toast(`Clawd updated himself to v${running}`)
    }
    await update($, updates, (): Update => ({ current: running, phase: 'idle' }))
    void checkForUpdate($)
    $.clock.every(CHECK_EVERY_MS, () => {
      void checkForUpdate($)
    })
    const saved = progressOf(await $.store.get(PROGRESS))
    await update($, game, () => ({ progress: saved, burst: false }))
    const hidden = (await $.store.get(HIDDEN)) === true
    await update($, isHidden, () => hidden)
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
      recent.calls += 1
      recent.tools.add(e.tool)
      if (e.tool === 'WebSearch' || e.tool === 'WebFetch') recent.searches += 1
      await setActivity($, 'typing')
    }
    return next(e)
  })

  // A subagent's turn ending must not put Clawd down while the main turn still runs; a turn
  // that made no request (interrupted before the first response, or dead on an API error) is no turn.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      if (e.usage) subTurns += 1
      return next(e)
    }
    await setActivity($, 'idle')
    if (e.usage) {
      const facts = { now: 0, usage: e.usage, tools: toolCalls, recent: { ...recent, tools: [...recent.tools] }, session: sessionFacts() }
      recent = { tools: new Set(), calls: 0, searches: 0 }
      mainTurns += 1
      await play($, (p, now) => afterTurn(p, { ...facts, now }))
    }
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
    // The week, the trophy case and the quests each open as a pane; the text stands in where one can't be drawn.
    if (verb === 'recap' || verb === 'badges' || verb === 'quests') {
      const p = progressOf(await $.store.get(PROGRESS))
      const now = await $.clock.now()
      if (verb === 'recap') return { text: await openPane($, RECAP, 'Your week', 16, recapOf(p, now) ? recapLines(recapOf(p, now)!.recap, recapOf(p, now)!.isLive).join('\n') : NO_WEEK_YET) }
      if (verb === 'badges') return { text: await openPane($, BADGES_PANE, 'Badges', 20, badgesOf(p, now, sessionFacts())) }
      return { text: await openPane($, QUESTS, 'Quests', 8, questsOf(p, now)) }
    }
    if (verb === 'card') {
      return { text: await saveCard($) }
    }
    if (verb === 'update') {
      const latest = await checkForUpdate($, true)
      return { text: latest ? await installUpdate($) : `usage-hud is up to date (v${running}).` }
    }
    const arg = rest.join(' ')
    // The shop opens as a pane; `wear`, `remove` and `buy` without an item open it too.
    if (verb === 'shop' && arg === 'list') {
      return { text: shopOf(progressOf(await $.store.get(PROGRESS))) }
    }
    if (verb === 'shop' || ((verb === 'buy' || verb === 'wear' || verb === 'remove') && !arg)) {
      return { text: await openShop($) }
    }
    // Each of these reads the progress fresh inside play(), so a purchase can't race a turn.
    const change = verb === 'buy' ? bought : verb === 'wear' ? dressed : verb === 'remove' ? undressed : undefined
    if (change) {
      return { text: (await play($, p => change(p, arg))) ?? 'Something went wrong; nothing changed.' }
    }
    let hidden = false
    await update($, isHidden, h => (hidden = !h))
    await $.store.set(HIDDEN, hidden)
    return { text: hidden ? 'Usage band hidden. /usage-hud brings it back.' : 'Usage band shown.' }
  })

  // The shop: every item in its slot, pressed to wear, buy or take off.
  on('ui.render', { component: 'Pane', requestId: SHOP }, async ($, e) => {
    const p = (await read($, game)).progress ?? progressOf(await $.store.get(PROGRESS))
    const level = levelOf(p.xp)
    const worn = outfitOf(p, level)
    const shelf = shelfOf(p)
    // The focus starts on the first thing Clawd has, reading the slots top to bottom.
    const first = SLOTS.flatMap(slot => shelf.filter(s => s.slot === slot)).find(s => s.state === 'wearing' || s.state === 'owned')?.id
    const coins = `${p.coins.toLocaleString('en-US')} coins`
    const wearing = SLOTS.flatMap(slot => (worn[slot] ? [nameOf(worn[slot])] : []))

    if (e.surface === 'terminal') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const label = (s: Shelf) =>
        s.state === 'wearing' ? `● ${s.name}` : s.state === 'buy' || s.state === 'short' ? `${s.name} ${s.price}c` : s.state === 'locked' ? `${s.name} Lv${s.level}` : s.name
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={CLAWD}>{FACES.happy}</Text>
            <Text bold>{`  Level ${level} ${titleOf(level)}`}</Text>
            <Text dimColor> · </Text>
            <Text color="yellow">{coins}</Text>
            <Text dimColor>{` · wearing ${wearing.join(', ') || 'nothing'}`}</Text>
          </Text>
          {SLOTS.map(slot => (
            <Box key={slot} flexDirection="row" gap={1}>
              <Box width={6} flexShrink={0}>
                <Text dimColor>{SLOT_NAMES[slot]}</Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={1}>
                {shelf
                  .filter(s => s.slot === slot)
                  .map(s => {
                    const change = pressOf(s)
                    return change ? (
                      <Button
                        key={`item:${s.id}`}
                        label={label(s)}
                        variant={s.state === 'wearing' ? 'primary' : undefined}
                        autoFocus={s.id === first || undefined}
                        onPress={() => shopPress($, change, s.id)}
                      />
                    ) : (
                      <Text key={`item:${s.id}`} dimColor>{` ${label(s)} `}</Text>
                    )
                  })}
              </Box>
            </Box>
          ))}
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Button key="none" label="take all off" plain dimColor onPress={() => shopPress($, dressed, 'none')} />
            <Text dimColor>Tab or arrows move · Enter wears, buys or takes off · Esc closes</Text>
          </Box>
        </Box>
      )
    }

    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    // A narrow sidebar stacks the header under Clawd, so the text keeps its width and the button stays in view.
    const wide = (e.props.bodyColumns || 100) * PX_PER_COLUMN >= SHOP_WIDE
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection={wide ? 'row' : 'column'} alignItems={wide ? 'center' : 'flex-start'} gap={wide ? 2 : 1}>
          <Svg source={wardrobeSvg(worn, 3)} alt={`Clawd wearing ${wearing.join(', ') || 'nothing'}`} width={132} height={84} />
          <Box flexDirection="column" alignItems="flex-start" flexGrow={1} flexShrink={1} gap={1}>
            <Box flexDirection="column">
              <Text bold>{`Level ${level} · ${titleOf(level)}`}</Text>
              <Text color={COLORS.golden}>{coins}</Text>
              <Text dimColor>{`1 coin per ${COINS.perTokens.toLocaleString('en-US')} tokens Claude writes, ${COINS.level} per level, ${COINS.badge} per badge`}</Text>
            </Box>
            <Button key="none" label="Take everything off" onPress={() => shopPress($, dressed, 'none')} />
          </Box>
        </Box>
        {SLOTS.map(slot => (
          <Box key={slot} flexDirection="column" gap={1}>
            <Text bold>{SLOT_NAMES[slot]}</Text>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {shelf
                .filter(s => s.slot === slot)
                .map(s => {
                  const change = pressOf(s)
                  // Each card shows Clawd trying the item on with the rest of his outfit.
                  return (
                    <Box
                      key={`card:${s.id}`}
                      flexDirection="column"
                      alignItems="center"
                      gap={1}
                      padding={1}
                      borderStyle="round"
                      borderColor={s.state === 'wearing' ? CLAWD : undefined}
                      borderDimColor={s.state !== 'wearing'}
                    >
                      <Svg source={wardrobeSvg({ ...worn, [slot]: s.id }, 2.5)} alt={`Clawd in the ${s.name}`} width={110} height={70} />
                      <Text dimColor={!change}>{s.name}</Text>
                      {change ? (
                        <Button
                          key={`item:${s.id}`}
                          label={s.state === 'wearing' ? 'Take off' : s.state === 'owned' ? 'Wear' : `Buy · ${s.price?.toLocaleString('en-US')}`}
                          variant={s.state === 'buy' ? 'primary' : 'secondary'}
                          onPress={() => shopPress($, change, s.id)}
                        />
                      ) : (
                        <Text dimColor>{s.state === 'locked' ? `Level ${s.level}` : `${s.price?.toLocaleString('en-US')} coins`}</Text>
                      )}
                    </Box>
                  )
                })}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })

  // The week: last week's recap until it's been seen, else this week so far, with the share card.
  on('ui.render', { component: 'Pane', requestId: RECAP }, async ($, e) => {
    const p = (await read($, game)).progress ?? progressOf(await $.store.get(PROGRESS))
    const now = await $.clock.now()
    const shown = recapOf(p, now)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (!shown) {
      return (
        <Box padding={1}>
          <Text dimColor>{NO_WEEK_YET}</Text>
        </Box>
      )
    }
    const { recap: r, isLive } = shown
    const [title, ...lines] = recapLines(r, isLive)
    const buttons = (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        <Button key="save" label="Save card" variant="primary" hotkey="s" onPress={() => savePress($)} />
        <Button key="done" label="Done" role="dismiss" hotkey="d" onPress={() => closeRecap($)} />
      </Box>
    )
    const hint = <Text dimColor>Save card writes a PNG and an SVG of this week to your Downloads folder, to post wherever you like.</Text>
    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text color={CLAWD}>{FACES.happy}</Text>
            <Text bold>{`  ${title}`}</Text>
          </Text>
          <Box flexDirection="column">
            {lines.map(line => (
              <Text key={line}>{line}</Text>
            ))}
          </Box>
          {buttons}
          {hint}
        </Box>
      )
    }
    const { Svg } = $.ui.resolve(e)
    const columns = e.props.bodyColumns || 100
    const width = Math.min(CARD_W * 2, Math.max(240, Math.round(columns * PX_PER_COLUMN) - 40))
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Svg
          source={cardSvg(r, outfitOf(p, levelOf(p.xp)), 2, isLive)}
          alt={`Week card: ${lines.slice(0, 2).join(', ')}`}
          width={width}
          height={Math.round((width * CARD_H) / CARD_W)}
        />
        <Box flexDirection="column">
          <Text bold>{title}</Text>
          {lines.map(line => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>
        {buttons}
        {hint}
      </Box>
    )
  })

  // The trophy case: every badge as a medal, lit once earned, with how far along the rest are.
  on('ui.render', { component: 'Pane', requestId: BADGES_PANE }, async ($, e) => {
    const p = (await read($, game)).progress ?? progressOf(await $.store.get(PROGRESS))
    const views = badgeViews(p, await $.clock.now(), sessionFacts())
    const earned = views.filter(v => v.earned).length
    const state = (v: BadgeView) =>
      v.earned
        ? `earned ${shortDate(v.earned)}`
        : v.progress
          ? `${bar((v.progress.at / v.progress.of) * 100, 6)} ${v.progress.at.toLocaleString('en-US')} of ${v.progress.of} ${v.progress.unit}`
          : (v.note ?? 'not yet')
    const header = `Badges · ${earned} of ${views.length}`
    const worth = `each worth ${XP.badge} XP and ${COINS.badge} coins`
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>{header}</Text>
            <Text dimColor>{` · ${worth}`}</Text>
          </Text>
          <Box flexDirection="column">
            {views.map(v => (
              <Text key={v.id}>
                <Text color={v.earned ? 'yellow' : undefined} dimColor={!v.earned}>{`${v.earned ? '★' : '☆'} ${v.name}`}</Text>
                <Text dimColor>{` · ${v.how} · ${state(v)}`}</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )
    }
    const { Box, Svg, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="column">
          <Text bold>{header}</Text>
          <Text dimColor>{worth}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {views.map(v => (
            <Box key={`badge:${v.id}`} flexDirection="column" alignItems="center" gap={1} padding={1} borderStyle="round" borderDimColor={!v.earned} borderColor={v.earned ? COLORS.golden : undefined}>
              <Svg source={medalSvg(!!v.earned, 4)} alt={v.earned ? `${v.name}, earned` : `${v.name}, not yet`} width={28} height={36} />
              <Text bold dimColor={!v.earned}>
                {v.name}
              </Text>
              <Text dimColor>{v.how}</Text>
              <Text color={v.earned ? COLORS.golden : undefined} dimColor={!v.earned}>
                {state(v)}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // Today's quests, the same for everyone: a box per quest, ticked when it's met.
  on('ui.render', { component: 'Pane', requestId: QUESTS }, async ($, e) => {
    const p = (await read($, game)).progress ?? progressOf(await $.store.get(PROGRESS))
    const now = await $.clock.now()
    const views = questViews(p, dayOf(now))
    const done = views.filter(v => v.isDone).length
    const { Box, Text } = $.ui.resolve(e)
    const progress = (v: QuestView) =>
      v.isDone ? 'done' : v.quest.goal > 1 ? `${v.at.toLocaleString('en-US')} of ${v.quest.goal.toLocaleString('en-US')}${v.quest.unit ? ` ${v.quest.unit}` : ''}` : 'not yet'
    const isTerminal = e.surface === 'terminal'
    const row = (v: QuestView) => (
      <Text key={v.key}>
        <Text color={v.isDone ? 'green' : undefined} dimColor={!v.isDone}>{v.isDone ? '☑ ' : '☐ '}</Text>
        <Text dimColor={v.isDone} strikethrough={v.isDone}>{v.quest.text}</Text>
        <Text dimColor>{` · ${progress(v)}`}</Text>
        <Text color="yellow" dimColor={v.isDone}>{` +${v.quest.coins} coins`}</Text>
        {v.isWeekly ? <Text dimColor> · this week</Text> : null}
      </Text>
    )
    return (
      <Box flexDirection="column" gap={1} padding={isTerminal ? 0 : 1}>
        <Box flexDirection="column">
          <Text bold>{`Quests · ${done} of ${views.length} done`}</Text>
          <Text dimColor>{`New ones in ${untilReset(untilMidnight(now))} · everyone gets the same quests today · coins on completion`}</Text>
        </Box>
        {isTerminal ? (
          <Box flexDirection="column">{views.map(row)}</Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            {views.map(v => (
              <Box key={`quest:${v.key}`} paddingX={1} borderStyle="round" borderDimColor={!v.isDone} borderColor={v.isDone ? TONES.ok : undefined}>
                {row(v)}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  // Esc or the close mark on the recap counts as having seen it.
  on('ui.close', { id: RECAP }, async ($, e, next) => {
    if (e.origin.kind === 'person') void play($, sawRecap)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { cur, prev } = await read($, gauges)
    if (!cur) return next(e)

    const now = await $.clock.now()
    const list = tanksOf(cur, prev, now)
    const { progress, burst } = await read($, game)
    const view = progress ? { ...gameViewOf(progress, now, burst), quests: questSummary(progress, dayOf(now)) } : undefined
    const { latest, phase } = await read($, updates)
    const updateLabel = !latest ? undefined : phase === 'installing' ? 'updating…' : phase === 'restart' ? `restart for ${latest}` : undefined
    const onUpdate = async () => $.ui.toast(await installUpdate($))
    // Last week's recap, offered until it's been opened.
    const recapLabel = progress && recapDue(progress) ? 'Week in review' : undefined
    const onRecap = () => openPane($, RECAP, 'Your week', 16, '')

    // Every surface but the terminal (desktop, VS Code, the Claude mobile app) draws Svg.
    if (e.surface !== 'terminal') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const columns = e.props.bodyColumns || e.viewport?.columns || 100
      // The image can't take a press, so the refresh control is a real Button beside it.
      const offer = latest && phase === 'idle' ? `Update to ${latest}` : updateLabel
      const width = Math.max(
        160,
        Math.round(columns * PX_PER_COLUMN) - REFRESH_W - (offer ? offer.length * 7 + 28 : 0) - (recapLabel ? recapLabel.length * 7 + 28 : 0),
      )
      // Drawn as an image, not an interactive frame: it stays transparent, and SMIL still plays.
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={pixelSvg(list, cur.usd, e.props.isWorking ? await read($, activity) : 'idle', width, view)}
            alt={(view ? [`Level ${view.level}`].concat(view.coins !== undefined ? [`${view.coins} coins`] : []) : []).concat(list.map(t => `${t.tag} ${Math.round(t.pct)}%`)).join(', ')}
            width={width}
            height={HEIGHT}
          />
          {recapLabel ? <Button key="recap" label={recapLabel} variant="secondary" onPress={onRecap} /> : null}
          {latest && phase === 'idle' ? (
            <Button key="update" label={`Update to ${latest}`} variant="primary" onPress={onUpdate} />
          ) : updateLabel ? (
            <Text dimColor>{updateLabel}</Text>
          ) : null}
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
      // The level as `Lv7 ▰▰▱ ●1.2k 🔥5`; the flame counts as two columns.
      const level = view ? `Lv${view.level}` : ''
      const xpBar = view ? bar(view.frac * 100, 3) : ''
      const coins = view?.coins !== undefined ? `●${coinsLabel(view.coins)}` : ''
      const flame = view && view.streak >= 3 ? `🔥${view.streak}` : ''
      const quests = view?.quests && view.quests.of > 0 ? `${view.quests.done >= view.quests.of ? '☑' : '☐'}${view.quests.done}/${view.quests.of}` : ''
      const gameWidth = (g: GameFit) =>
        !view || g === 'none'
          ? 0
          : level.length + 1 + xpBar.length + (coins ? coins.length + 1 : 0) + 2 + (g === 'full' && flame ? flame.length + 2 : 0) + (g === 'full' && quests ? quests.length + 2 : 0)
      // Fit the row to the terminal: give up the streak, the level, the long note, the cost,
      // the short note, then the bars.
      // The update offer is never given up: it sits at the right, and the rest fits around it.
      const offer = latest && phase === 'idle' ? `u: update ${latest}` : updateLabel
      const recapOffer = recapLabel ? 'w: week in review' : undefined
      const cols = (e.props.bodyColumns || e.viewport?.columns || 80) - (offer ? offer.length + 2 : 0) - (recapOffer ? recapOffer.length + 2 : 0)
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
              {coins ? <Text color="yellow" dimColor>{` ${coins}`}</Text> : null}
              {g === 'full' && flame ? <Text dimColor>{`  ${flame}`}</Text> : null}
              {g === 'full' && quests ? <Text dimColor>{`  ${quests}`}</Text> : null}
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
          {recapLabel ? <Button key="recap" label="week in review" plain hotkey="w" onPress={onRecap} /> : null}
          {latest && phase === 'idle' ? (
            <Button key="update" label={`update ${latest}`} plain hotkey="u" onPress={onUpdate} />
          ) : updateLabel ? (
            <Text dimColor>{updateLabel}</Text>
          ) : null}
          <Button key="refresh" label="↻" plain dimColor hotkey="r" onPress={() => refresh($)} />
        </Box>
      )
    }

    return next(e)
  })
}
