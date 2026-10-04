import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { Gauges, Snapshot } from '../types'

const gauges = atom({ plugin: 'usage-hud', key: 'gauges' } as const, { cur: null, prev: null })
const isHidden = atom({ plugin: 'usage-hud', key: 'isHidden' } as const, false)

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
  tip: string
}

function tanksOf(cur: Snapshot, prev: Snapshot | null, now: number): Tank[] {
  const used = cur.ctxTokens === undefined ? '' : `${tokens(cur.ctxTokens)} / `
  const list: Tank[] = [
    {
      tag: 'ctx',
      pct: cur.ctxPct,
      from: prev?.ctxPct ?? 0,
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
const SPRITE_W = 50
const TAG_W = 26
const PCT_W = 36
const USD_W = 46
const PX_PER_COLUMN = 7.8 // the desktop counts the band in code-font cells
const CLAWD = '#D97757'
const INK = '#1b1b1b'
const MUTED = '#8b9099'

const TONES: Record<Tone, string> = {
  ok: '#6b9e7a',
  warn: '#c4a05a',
  hot: '#c06565',
}

type Mood = 'happy' | 'anxious' | 'frantic' | 'panic' | 'dead'

function moodOf(pct: number): Mood {
  return pct >= 100 ? 'dead' : pct >= 95 ? 'panic' : pct >= 80 ? 'frantic' : pct >= 50 ? 'anxious' : 'happy'
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

// Clawd, 13 pixels wide: a 9-wide body, arms either side, four legs.
const BODY = Array.from({ length: 7 }, () => '..#########..')
const ARMS_MID = ['', '', '', '##.........##', '##.........##']
const ARMS_UP = ['', '##.........##', '##.........##']
const ARMS_LOW = ['', '', '', '', '', '##.........##', '##.........##']
const LEGS_TOP = ['', '', '', '', '', '', '', '...#.#.#.#...']
const LEGS_ALL = [...LEGS_TOP, '...#.#.#.#...']
const LEGS_A = ['', '', '', '', '', '', '', '', '...#...#.....']
const LEGS_B = ['', '', '', '', '', '', '', '', '.....#...#...']
const BLUSH = ['', '', '', '', '...#.....#...']

const EYES: Record<Mood, [string[], string[]]> = {
  happy: [['.#.', '#.#', '...'], ['.#.', '#.#', '...']],
  anxious: [['.#.', '.#.', '...'], ['.#.', '.#.', '...']],
  frantic: [['#..', '.##', '.##'], ['..#', '##.', '##.']],
  panic: [['###', '#.#', '###'], ['###', '#.#', '###']],
  dead: [['#.#', '.#.', '#.#'], ['#.#', '.#.', '#.#']],
}
const CLOSED = ['', '', '...###.###...']

function eyesOf(mood: Mood): string[] {
  const [l, r] = EYES[mood]
  return ['', ...l.map((row, y) => `...${row}.${r[y]}...`)]
}

const DROP = ['.#.', '###', '.#.']
const HEART = ['.#.#.', '#####', '.###.', '..#..']
const BANG = ['#', '#', '#', '.', '#']
const SOUL = ['.##.', '####', '#..#']

function clawdSvg(mood: Mood, isWorking: boolean): string {
  const path = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`
  const toggle = (dur: string, first: boolean) =>
    `<animate attributeName="opacity" values="${first ? '1;0' : '0;1'}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
  const motion: Record<Mood, string> = {
    happy: 'values="0 0;0 -2;0 0" keyTimes="0;0.9;0.95" dur="5s"',
    anxious: '',
    frantic: 'values="0 0;1 0;0 0" keyTimes="0;0.8;0.9" dur="2s"',
    panic: 'values="0 0;-1 0;1 0;0 0" keyTimes="0;0.7;0.8;0.9" dur="1.2s"',
    dead: '',
  }
  const body = mood === 'dead' ? '#8f7a70' : CLAWD
  const flash =
    mood === 'panic'
      ? '<animate attributeName="fill" values="#D97757;#c06565" keyTimes="0;0.5" calcMode="discrete" dur="1.6s" repeatCount="indefinite"/>'
      : ''
  const arms =
    mood === 'frantic' || mood === 'panic'
      ? `<g>${path(pixels(ARMS_MID, 0, 0, P), body)}${toggle(mood === 'panic' ? '1.2s' : '2s', true)}</g>` +
        `<g>${path(pixels(ARMS_UP, 0, 0, P), body)}${toggle(mood === 'panic' ? '1.2s' : '2s', false)}</g>`
      : path(pixels(mood === 'dead' ? ARMS_LOW : ARMS_MID, 0, 0, P), body)
  const legs =
    isWorking && mood !== 'dead'
      ? path(pixels(LEGS_TOP, 0, 0, P), body) +
        `<g>${path(pixels(LEGS_A, 0, 0, P), body)}${toggle('1s', true)}</g>` +
        `<g>${path(pixels(LEGS_B, 0, 0, P), body)}${toggle('1s', false)}</g>`
      : path(pixels(LEGS_ALL, 0, 0, P), body)
  // Anxious Clawd blinks: open most of the time, a flick of closed eyes.
  const eyes =
    mood === 'anxious'
      ? `<g>${path(pixels(eyesOf(mood), 0, 0, P), INK)}<animate attributeName="opacity" values="1;0" keyTimes="0;0.94" calcMode="discrete" dur="5s" repeatCount="indefinite"/></g>` +
        `<g opacity="0">${path(pixels(CLOSED, 0, 0, P), INK)}<animate attributeName="opacity" values="0;1" keyTimes="0;0.94" calcMode="discrete" dur="5s" repeatCount="indefinite"/></g>`
      : path(pixels(eyesOf(mood), 0, 0, P), INK)
  const blush = mood === 'happy' ? path(pixels(BLUSH, 0, 0, P), '#dba3ae') : ''

  const fx = 13 * P + 1
  const drop = (x: number, begin: string) =>
    `<g>${path(pixels(DROP, 0, 0, 1.2), '#86a8c4')}
      <animateTransform attributeName="transform" type="translate" values="${x} 1;${x} 4;${x} 7;${x} 10" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="3s" begin="${begin}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;1;1;0" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="3s" begin="${begin}" repeatCount="indefinite"/></g>`
  const effects: Record<Mood, string> = {
    happy: `<g opacity="0">${path(pixels(HEART, 0, 0, 1.2), '#cf8a98')}
      <animateTransform attributeName="transform" type="translate" values="${fx} 8;${fx} 5;${fx} 2;${fx} -1" keyTimes="0;0.62;0.72;0.82" calcMode="discrete" dur="8s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;1;0" keyTimes="0;0.6;0.72;0.82;0.92" calcMode="discrete" dur="8s" repeatCount="indefinite"/></g>`,
    anxious: drop(fx, '0s'),
    frantic:
      drop(fx, '0s') +
      drop(fx + 4, '1.5s') +
      `<g transform="translate(${fx + 9} 1)">${path(pixels(BANG, 0, 0, 1.6), '#c4a05a')}${toggle('2s', true)}</g>`,
    panic:
      drop(fx, '0s') +
      `<g transform="translate(${fx + 4} 1)">${path(pixels(BANG, 0, 0, 1.6) + pixels(BANG, 3.2, 0, 1.6), '#c06565')}${toggle('1.2s', true)}</g>`,
    dead: `<g>${path(pixels(SOUL, 0, 0, 1.4), 'rgba(255,255,255,0.75)')}
      <animateTransform attributeName="transform" type="translate" values="8 2;8 -1;8 -4;8 -7" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="1;0.8;0.5;0.2" keyTimes="0;0.25;0.5;0.75" calcMode="discrete" dur="6s" repeatCount="indefinite"/></g>`,
  }
  const move = motion[mood]
    ? `<animateTransform attributeName="transform" type="translate" ${motion[mood]} calcMode="discrete" repeatCount="indefinite"/>`
    : ''
  return `<g transform="translate(2 5)">
    <g>${move}
      <path d="${pixels(BODY, 0, 0, P)}" fill="${body}">${flash}</path>
      ${arms}${legs}${eyes}${blush}
    </g>
    ${effects[mood]}
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

function pixelSvg(list: Tank[], usd: number | undefined, isWorking: boolean, columns: number): string {
  const width = Math.max(420, Math.round(columns * PX_PER_COLUMN))
  const mood = moodOf(Math.max(...list.map(t => t.pct)))
  const unit = (width - SPRITE_W - (usd === undefined ? 0 : USD_W)) / list.length
  const rw = Math.max(40, unit - TAG_W - PCT_W - 6)
  const ty = BY + (BH - 5 * FP) / 2
  const units = list.map((t, i) => {
    const bar = barSvg(t, i, rw)
    const pct = `${Math.round(t.pct)}%`
    return `<g transform="translate(${n2(SPRITE_W + i * unit)} 0)">
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
  ${clawdSvg(mood, isWorking)}
  ${units.join('\n')}
</svg>`
}

const FACES: Record<Mood, string> = {
  happy: '(^‿^)',
  anxious: '(・_・;)',
  frantic: '(°□°;)',
  panic: '(ﾟДﾟ;)',
  dead: '(x_x)',
}

function bar(pct: number, cells = 5): string {
  const full = Math.round((Math.min(100, pct) / 100) * cells)
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

let settle: { cancel: () => void } | undefined

async function take($: EngineInterface, snap: Snapshot) {
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
      const { Svg } = $.ui.resolve(e)
      const columns = e.props.bodyColumns || e.viewport?.columns || 100
      const svg = pixelSvg(list, cur.usd, e.props.isWorking, columns)
      // Drawn as an image, not an interactive frame: it stays transparent, and SMIL still plays.
      return (
        <Svg
          source={svg}
          alt={list.map(t => `${t.tag} ${Math.round(t.pct)}%`).join(', ')}
          width={Math.max(420, Math.round(columns * PX_PER_COLUMN))}
          height={HEIGHT}
        />
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const color = (pct: number) => ({ ok: 'cyan', warn: 'yellow', hot: 'red' })[tone(pct)]
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="#D97757">{FACES[moodOf(Math.max(...list.map(t => t.pct)))]}</Text>
          {list.map(t => (
            <Text>
              <Text dimColor>{t.tag} </Text>
              <Text color={color(t.pct)}>{bar(t.pct)}</Text>
              <Text bold> {Math.round(t.pct)}</Text>
            </Text>
          ))}
          {cur.usd !== undefined ? <Text dimColor>${cur.usd.toFixed(2)}</Text> : null}
        </Box>
      )
    }

    return next(e)
  })
}
