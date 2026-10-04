import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Activity, Gauges, Limit, Snapshot } from '../types'

const gauges = atom({ plugin: 'usage-hud', key: 'gauges' } as const, { cur: null, prev: null })
const isHidden = atom({ plugin: 'usage-hud', key: 'isHidden' } as const, false)
const activity = atom({ plugin: 'usage-hud', key: 'activity' } as const, 'idle')

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
}

// Each mood is a small scene, not a dance: Clawd holds still and one prop moves, slowly.
function clawdSvg(mood: Mood, doing: Activity): string {
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
  const body = mood === 'asleep' ? COLORS.sleepy : CLAWD
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
    ${legs}<path d="${pixels(BODY, 0, 0, P)}" fill="${body}"/>
    ${headphones}${eyes}${blush}${arms}${laptop}${mug}
    ${left[mood]}${thinking ? thought : right[mood]}
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
  const width = Math.round(note.length * NOTE_CHAR + 14)
  const esc = note.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;')
  // A square speech bubble with a stepped pixel tail pointing back at Clawd.
  const svg = `<g transform="translate(${x} 0)">
    <path d="${pixels(['..#', '.##', '..#'], -4.5, 9, 1.5)}" fill="${MUTED}" opacity="0.45"/>
    <rect x="0.5" y="5.5" width="${width - 1}" height="13" fill="${MUTED}" fill-opacity="0.08" stroke="${MUTED}" stroke-opacity="0.45"/>
    <text x="6" y="15.2" fill="${color}" style="font: 500 9.5px ui-monospace, SFMono-Regular, Menlo, monospace">${esc}</text>
  </g>`
  return { svg, width }
}

function pixelSvg(list: Tank[], usd: number | undefined, doing: Activity, width: number): string {
  const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
  const mood = moodOf(worst.pct)
  const text = noteOf(worst)
  const note = text ? noteSvg(text, SPRITE_W, TONES[tone(worst.pct)]) : undefined
  const left = SPRITE_W + (note ? note.width + 12 : 0)
  const unit = (width - left - (usd === undefined ? 0 : USD_W)) / list.length
  const rw = Math.max(40, unit - TAG_W - PCT_W - 6)
  const ty = BY + (BH - 5 * FP) / 2
  const units = list.map((t, i) => {
    const bar = barSvg(t, i, rw)
    const pct = `${Math.round(t.pct)}%`
    return `<g transform="translate(${n2(left + i * unit)} 0)"${t.isSaved ? ' opacity="0.5"' : ''}>
      <path d="${textPixels(t.tag, 0, ty)}" fill="${MUTED}"/>
      <g transform="translate(${TAG_W} 0)">${bar.svg}</g>
      <path d="${textPixels(pct, TAG_W + bar.width + 5, ty)}" fill="${TONES[tone(t.pct)]}"/>
    </g>`
  })
  if (usd !== undefined) {
    const s = `$${usd.toFixed(2)}`
    units.push(`<path d="${textPixels(s, width - textWidth(s) - 2, ty)}" fill="${MUTED}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}" shape-rendering="crispEdges">
  ${clawdSvg(mood, doing)}
  ${note?.svg ?? ''}
  ${units.join('\n')}
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
      description: 'Show or hide the usage roads above the prompt',
    })
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
    if (!e.agentId) await setActivity($, 'typing')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await setActivity($, 'idle')
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await take($, snapshotOf(e))
    return next(e)
  })

  on('command.run', { command: 'usage-hud' }, async $ => {
    let hidden = false
    await update($, isHidden, h => (hidden = !h))
    return { text: hidden ? 'Usage roads hidden.' : 'Usage roads shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const { cur, prev } = await read($, gauges)
    if (!cur) return next(e)

    const list = tanksOf(cur, prev, await $.clock.now())

    if (e.surface === 'desktop') {
      const { Box, Button, Svg } = $.ui.resolve(e)
      const columns = e.props.bodyColumns || e.viewport?.columns || 100
      // The image can't take a press, so the refresh control is a real Button beside it.
      const width = Math.max(420, Math.round(columns * PX_PER_COLUMN) - REFRESH_W)
      // Drawn as an image, not an interactive frame: it stays transparent, and SMIL still plays.
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={pixelSvg(list, cur.usd, e.props.isWorking ? await read($, activity) : 'idle', width)}
            alt={list.map(t => `${t.tag} ${Math.round(t.pct)}%`).join(', ')}
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
      const note = noteOf(worst)
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="#D97757">{FACES[moodOf(worst.pct)]}</Text>
          {list.map(t => (
            <Text>
              <Text dimColor>{t.tag} </Text>
              <Text color={color(t.pct)}>{bar(t.pct)}</Text>
              <Text bold dimColor={t.isSaved}> {Math.round(t.pct)}</Text>
            </Text>
          ))}
          {cur.usd !== undefined ? <Text dimColor>${cur.usd.toFixed(2)}</Text> : null}
          {note ? <Text color={color(worst.pct)}>{note}</Text> : null}
          <Button key="refresh" label="↻" plain dimColor hotkey="r" onPress={() => refresh($)} />
        </Box>
      )
    }

    return next(e)
  })
}
