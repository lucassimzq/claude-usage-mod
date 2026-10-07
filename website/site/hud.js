// The usage-hud mod's own drawing and game code (hooks/register.tsx at f9eac9b, #region drawing and
// #region game), with the TypeScript stripped. Every crab, band, outfit and backdrop on this page comes from it.
;(function () {
'use strict'
// #region drawing: pure, no $; scripts/render-docs.ts renders the README images from it
const SWEEP_MS = 1400
const WARN_AT = [50, 80, 95]

// Short tags keep the band quiet; the hover tooltip carries the words.
const TAGS                                                                   = {
  five_hour: { tag: '5h', name: 'Session', windowMs: 5 * 3600_000 },
  seven_day: { tag: '7d', name: 'Weekly', windowMs: 7 * 86400_000 },
  spend_limit: { tag: '$', name: 'Spend' },
}

function snapshotOf(u   
                              
                                
                    
 )           {
  return {
    ctxPct: u.context.percent ?? 0,
    ctxTokens: u.context.tokens,
    ctxWindow: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, pct: l.percentUsed, resetsAt: l.resetsAt })),
    usd: u.cost?.usd,
  }
}

function tokens(n        )         {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return `${n}`
}

function untilReset(ms        )         {
  const mins = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

                                 

function tone(pct        )       {
  return pct >= 80 ? 'hot' : pct >= 50 ? 'warn' : 'ok'
}

             
             
             
              
                                                                        
                  
                                                                  
              
                                                                                 
                  
                                                                                 
                   
             
 

function tanksOf(cur          , prev                 , now        )         {
  const used = cur.ctxTokens === undefined ? '' : `${tokens(cur.ctxTokens)} / `
  const list         = [
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

const TONES                       = {
  ok: '#6b9e7a',
  warn: '#c4a05a',
  hot: '#c06565',
}

                                                                

function moodOf(pct        )       {
  return pct >= 100 ? 'asleep' : pct >= 95 ? 'panic' : pct >= 80 ? 'frantic' : pct >= 50 ? 'anxious' : 'happy'
}

const n2 = (n        ) => Math.round(n * 100) / 100

/** One path of `p`-sized squares, one per `ch` in the grid. */
function pixels(grid          , ox        , oy        , p        , ch = '#')         {
  let d = ''
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === ch) d += `M${n2(ox + x * p)} ${n2(oy + y * p)}h${p}v${p}h-${p}z`
    }
  })
  return d
}

const rect = (x        , y        , w        , h        ) => `M${n2(x)} ${n2(y)}h${w}v${h}h-${w}z`

// A 3x5 pixel font, just the glyphs the band prints.
const FONT                           = {
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
  p: ['###', '#.#', '###', '#..', '#..'],
  '+': ['...', '.#.', '###', '.#.', '...'],
}

/** `s` in the pixel font, `p` px to a font pixel. */
function textPixels(s        , x        , y        , p = FP)         {
  return [...s].map((ch, i) => pixels(FONT[ch] ?? [], x + i * 4 * p, y, p)).join('')
}

const textWidth = (s        , p = FP) => (s.length * 4 - 1) * p

/** The font pixel that fits `s` into `room`: `p`, or smaller if it must be. */
const fitP = (s        , room        , p        ) => Math.min(p, room / (s.length * 4 - 1))

// A gain plays for this long; then the band redraws without it, so a still frame that
// never animates still shows the gain, and the steady figures come back on their own.
const GAIN_MS = 2400

/** One discrete opacity step for a gain: shown until `at` of the beat, or hidden until then. */
const gainBeat = (isShown         , at = 0.8) =>
  `<animate attributeName="opacity" values="${isShown ? '1;0' : '0;1'}" keyTimes="0;${at}" calcMode="discrete" dur="${GAIN_MS}ms" fill="freeze"/>`

/** A two-step hop up into place; the `transform` attribute is the resting place, for a still frame. */
const GAIN_HOP = `<animateTransform attributeName="transform" type="translate" values="0 2;0 1;0 0" keyTimes="0;0.05;0.1" calcMode="discrete" dur="${GAIN_MS}ms" fill="freeze"/>`

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

const EYES                                     = {
  happy: [['.#.', '#.#', '...'], ['.#.', '#.#', '...']],
  anxious: [['.#.', '.#.', '...'], ['.#.', '.#.', '...']],
  frantic: [['#..', '.##', '.##'], ['..#', '##.', '##.']],
  panic: [['###', '#.#', '###'], ['###', '#.#', '###']],
  asleep: [['...', '###', '...'], ['...', '###', '...']],
}
const CLOSED = ['', '', '...###.###...']

function eyesOf(mood      )           {
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

const SHELLS                         = {
  golden: '#d9b25a',
  mint: '#86b89a',
  lilac: '#a99be0',
  rose: '#d98fa0',
  midnight: '#56679a',
}

// Each mood is a small scene, not a dance: Clawd holds still and one prop moves, slowly.
// `props` false leaves out the scene (headphones, notes, mug, flames): Clawd alone, as the shop shows him.
// `pop` is a gain to show beside him, when the band has no room for the level cluster.
function clawdSvg(
  mood      ,
  doing          ,
  outfit                         = {},
  burst = false,
  props = true,
  pop       ,
)         {
  const path = (d        , fill        , extra = '') => (d ? `<path d="${d}" fill="${fill}"${extra}/>` : '')
  const grid = (g          , fill        , ch = '#', ox = 0, oy = 0, p = P) => path(pixels(g, ox, oy, p, ch), fill)
  const toggle = (dur        , first         ) =>
    `<animate attributeName="opacity" values="${first ? '1;0' : '0;1'}" keyTimes="0;0.5" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>`
  // Something drifting up and fading: notes, Z's, a sweat drop running down.
  const drift = (inner        , x        , ys          , dur        , begin = 0) => {
    const values = ys.map(y => `${x} ${y}`).join(';')
    const keys = ys.map((_, k) => n2(k / ys.length)).join(';')
    const fade = ys.map((_, k) => (k === ys.length - 1 ? 0 : 1)).join(';')
    return `<g transform="translate(${x} ${ys[0]})">${inner}
      <animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keys}" calcMode="discrete" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="${fade}" keyTimes="${keys}" calcMode="discrete" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/></g>`
  }

  const typing = doing === 'typing' && mood !== 'asleep'
  const thinking = doing === 'thinking' && mood !== 'asleep'
  // He puts the mug down to catch a gain, so it has room on his right.
  const holdsMug = props && !pop && !typing && (mood === 'anxious' || mood === 'panic')
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
  const art                               = {
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
  const wearing = (slot        ) => {
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
  const flames = (x        ) =>
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
  const right                       = {
    happy: drift(note, fx, [8, 5, 2, -1], 3.2) + drift(note, fx + 6, [8, 5, 2, -1], 3.2, 1.6),
    anxious: '',
    frantic: clock,
    panic: flames(fx),
    asleep:
      drift(grid(ZED, COLORS.zed, '#', 0, 0, 1.1), fx, [6, 3, 0, -3], 4) +
      drift(grid(ZED, COLORS.zed, '#', 0, 0, 0.8), fx + 7, [6, 3, 0, -3], 4, 2),
  }
  const left                       = { happy: '', anxious: sweat, frantic: sweat, panic: flames(-7), asleep: '' }
  // A gain hops up on his right, `+10` over a coin and `+3`, and fades; the props wait.
  const gained = pop && (pop.xp > 0 || pop.coins > 0)
  const room = SPRITE_W - 8 - fx - 3 // a little gap before the figures
  let popped = ''
  if (pop && gained) {
    const xp = `+${coinsLabel(pop.xp)}`
    const coins = `+${coinsLabel(pop.coins)}`
    const cp = fitP(`.${coins}`, room - 2, COIN_P)
    if (pop.xp > 0) popped += path(textPixels(xp, 0, -3, fitP(xp, room, LV_P)), COLORS.level)
    if (pop.coins > 0) popped += path(pixels(COIN, 0, 6, cp), COLORS.coin) + path(textPixels(coins, 5 * cp + 2, 6, cp), COLORS.coin)
    popped = `<g transform="translate(${fx} 0)"><g transform="translate(0 0)">${popped}${GAIN_HOP}</g>${gainBeat(true, 0.85)}</g>`
  }
  const side = gained ? popped : thinking ? thought : props ? right[mood] : ''
  return `<g transform="translate(8 5)">
    ${wearing('back')}${legs}<path d="${pixels(BODY, 0, 0, P)}" fill="${body}"/>
    ${headphones}${eyes}${blush}${arms}${wearing('neck')}${wearing('face')}${wearing('head')}${laptop}${mug}${wearing('buddy')}
    ${props ? left[mood] : ''}${side}${sparkles}
  </g>`
}

function barSvg(t      , i        , rw        )                                 {
  const n = Math.max(6, Math.floor((rw + GAP) / (CW + GAP)))
  const width = n * (CW + GAP) - GAP
  const lit = (p        ) => (p <= 0 ? 0 : Math.max(1, Math.round((Math.min(100, p) / 100) * n)))
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
function noteOf(worst      )                     {
  const pct = worst.pct
  if (pct >= 100) return `${cap(worst.name)} reached${worst.resetIn ? ` · resets in ${worst.resetIn}` : ''}`
  if (pct >= 95) return `${cap(worst.name)} nearly used up`
  if (pct >= 80) return `You're almost reaching your ${worst.name}`
  if (pct >= 50) return `${cap(worst.name)} is over half used`
  return undefined
}

const cap = (s        ) => s.charAt(0).toUpperCase() + s.slice(1)

const NOTE_CHAR = 5.9 // a 9.5px monospace advance, with a little slack

function noteSvg(note        , x        , color        )                                 {
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
const SHORT_NAMES                         = {
  'context window': 'Context',
  'session limit': 'Session',
  'weekly limit': 'Weekly',
  'spend limit': 'Spend',
}

function shortNoteOf(worst      )                     {
  const name = SHORT_NAMES[worst.name] ?? cap(worst.name)
  const pct = worst.pct
  if (pct >= 100) return worst.resetIn ? `${name} resets in ${worst.resetIn}` : `${name} used up`
  if (pct >= 95) return `${name} nearly out`
  if (pct >= 80) return `${name} almost full`
  if (pct >= 50) return `${name} over half`
  return undefined
}

const noteWidthOf = (note        ) => Math.round(note.length * NOTE_CHAR + 14)

const UNIT_GAP = 10 // between one figure's percentage and the next one's tag
const NOTE_GAP = 12
const MIN_BAR = 6 * (CW + GAP) - GAP
const COMFY_BAR = 12 * (CW + GAP) - GAP
const NOTE_BAR = 8 * (CW + GAP) - GAP // a short note is worth slightly shorter bars
const MAX_BAR = 56 * (CW + GAP) - GAP // past this, extra room goes between the figures

/** How the level cluster is shown: level, XP bar and streak; level and XP bar; or not at all. */
                                        

           
                                                                                
                                                                                

// The richest arrangement that fits, giving things up in order: the level cluster's
// streak, the rest of the cluster, the long note, the cost, a little bar length, the
// short note, more bar length, then the bars themselves, then all but the highest figure.
function planOf(
  width        ,
  list        ,
  usd                    ,
  worst      ,
  game                                           ,
)       {
  const n = list.length
  const fits = (g         , note                    , showUsd         , minBar        )                   => {
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

const compactUnitWidth = (list        ) =>
  Math.max(...list.map(t => textWidth(t.tag) + 5 + textWidth(`${Math.round(t.pct)}%`))) + UNIT_GAP + 4

// `width` is what the figures are laid out in; `paint` (at least `width`) is how far the
// drawing reaches, so a backdrop can run on under a control laid over its right end.
function pixelSvg(list        , usd                    , doing          , width        , view           , paint = width)         {
  const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
  const mood = moodOf(worst.pct)
  const sizes = view ? { full: gameSvg(view, 0, 'full').width, short: gameSvg(view, 0, 'short').width } : undefined
  const plan = planOf(width, list, usd, worst, sizes)
  const cluster = view && plan.game !== 'none' ? gameSvg(view, SPRITE_W, plan.game) : undefined
  const noteX = SPRITE_W + (cluster ? cluster.width + NOTE_GAP : 0)
  const note = plan.note ? noteSvg(plan.note, noteX, TONES[tone(worst.pct)]) : undefined
  const left = noteX + (note ? note.width + NOTE_GAP : 0)
  const ty = BY + (BH - 5 * FP) / 2
  const figure = (t      , x        , body        ) =>
    `<g transform="translate(${n2(x)} 0)"${t.isSaved ? ' opacity="0.5"' : ''}>${body}</g>`
  const label = (t      , x        ) =>
    `<path d="${textPixels(`${Math.round(t.pct)}%`, x, ty)}" fill="${TONES[tone(t.pct)]}"/>`
  const tag = (t      ) => `<path d="${textPixels(t.tag, 0, ty)}" fill="${MUTED}"/>`

  let units          
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
  const scene = view?.outfit?.scene
  // The thought and clock bubbles are open, so the landmarks behind them step aside.
  const bubble = (doing === 'thinking' && mood !== 'asleep') || mood === 'frantic'
  const full = Math.max(width, paint)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${full}" height="${HEIGHT}" viewBox="0 0 ${full} ${HEIGHT}" shape-rendering="crispEdges">
  ${scene ? `<g opacity="${SCENE_OPACITY}">${sceneSvg(scene, 0, 0, SCENE_W, HEIGHT, full, left, bubble)}</g>` : ''}${clawdSvg(mood, doing, view?.outfit, view?.burst, true, cluster ? undefined : view?.gain)}
  ${cluster?.svg ?? ''}${note?.svg ?? ''}
  ${units.join('\n')}
</svg>`
}

// Levels: each costs 100 XP more than the last, so level L needs 50·L·(L−1) XP in all.
const xpFor = (level        ) => 50 * level * (level - 1)

function levelOf(xp        )         {
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * Math.max(0, xp))) / 2))
  while (xpFor(level + 1) <= xp) level++
  while (level > 1 && xpFor(level) > xp) level--
  return level
}

// Milestones: a title from each, and something to wear from most.
const LEVELS                                                 = [
  { at: 1, title: 'Hatchling' },
  { at: 3, title: 'Hatchling', item: 'scarf' },
  { at: 5, title: 'Apprentice', item: 'beanie' },
  { at: 10, title: 'Tinkerer', item: 'sunglasses' },
  { at: 15, title: 'Builder', item: 'hardhat' },
  { at: 20, title: 'Architect', item: 'cape' },
  { at: 30, title: 'Wizard', item: 'wizard' },
  { at: 50, title: 'Legend', item: 'golden' },
]

                                                                           
const SLOTS         = ['head', 'face', 'neck', 'back', 'shell', 'buddy', 'scene']
const SLOT_NAMES                       = { head: 'Head', face: 'Face', neck: 'Neck', back: 'Back', shell: 'Shell', buddy: 'Buddy', scene: 'Backdrop' }

// Everything Clawd can wear: level unlocks (no price) and the shop, cheapest first.
// `level` on a shop item is the level it needs before it can be bought.
const ITEMS                                                                               = {
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
  forest: { name: 'forest', slot: 'scene', price: 300 },
  beach: { name: 'beach', slot: 'scene', price: 300 },
  city: { name: 'city at night', slot: 'scene', price: 400 },
  medal: { name: 'medal', slot: 'neck', price: 500, level: 10 },
  midnight: { name: 'midnight shell', slot: 'shell', price: 600 },
  australia: { name: 'Australia', slot: 'scene', price: 600 },
  malaysia: { name: 'Malaysia', slot: 'scene', price: 600 },
  crab: { name: 'tiny crab', slot: 'buddy', price: 800, level: 5 },
  space: { name: 'space', slot: 'scene', price: 1000, level: 10 },
  halo: { name: 'halo', slot: 'head', price: 1200, level: 15 },
  wings: { name: 'wings', slot: 'back', price: 1500, level: 25 },
  crown: { name: 'crown', slot: 'head', price: 2000, level: 20 },
}

const nameOf = (id        ) => ITEMS[id]?.name ?? id
/** An item's name in a sentence: `the forest backdrop` reads better than `the forest`. */
const called = (id        ) => (ITEMS[id]?.slot === 'scene' ? `${nameOf(id)} backdrop` : nameOf(id))

const reached = (level        ) => LEVELS.filter(m => m.at <= level)
const titleOf = (level        ) => reached(level).at(-1)?.title ?? 'Hatchling'
const itemsOf = (level        ) => reached(level).flatMap(m => (m.item ? [m.item] : []))

const owns = (p          , level        , id        ) => itemsOf(level).includes(id) || (p.owned ?? []).includes(id)

/** What Clawd wears, slot by slot: the pick if it's owned, else the newest level unlock for that slot. */
function outfitOf(p          , level        )                         {
  const out                         = {}
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
function dayOf(ms        )         {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whole days from one `YYYY-MM-DD` to another; negative if the second is earlier. */
const daysBetween = (a        , b        ) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** A streak is still alive if the days missed since its last day can be covered by rest days. */
function liveStreak(p          , now        )         {
  const s = p.streak
  if (!s.lastDay) return 0
  const missed = daysBetween(s.lastDay, dayOf(now)) - 1
  return missed <= s.restDays ? s.count : 0
}

                 
               
              
                
                
                                 
                 
             
 

/** How far through its level `xp` is, 0 to 1. */
function fracOf(xp        )         {
  const level = levelOf(xp)
  return (xp - xpFor(level)) / (xpFor(level + 1) - xpFor(level))
}

function gameViewOf(p          , now        , burst = false, gain       )           {
  const level = levelOf(p.xp)
  return { level, frac: fracOf(p.xp), streak: liveStreak(p, now), coins: p.coins, outfit: outfitOf(p, level), burst, gain }
}

/** A coin count in at most four characters: `950`, `1.2k`, `12k`, `120k`. */
function coinsLabel(n        )         {
  const c = Math.max(0, Math.floor(n))
  if (c < 1000) return `${c}`
  if (c < 10_000) return `${Math.floor(c / 100) / 10}k`
  return `${Math.floor(c / 1000)}k`
}

const COIN = ['.###.', '#####', '#####', '#####', '.###.']
// The coin turning on its edge, for a gain: face, half, edge, half, face again.
const COIN_TURN = [COIN, ['..#..', '.###.', '.###.', '.###.', '..#..'], ['..#..', '..#..', '..#..', '..#..', '..#..'], ['..#..', '.###.', '.###.', '.###.', '..#..']]
const LV_P = 1.4 // the level's font pixel, a little smaller than the bars' so the coins fit below
const COIN_P = 1.2

// The level cluster beside Clawd: `Lv7` over a thin XP bar and the coin balance, then a
// flame and the streak from its third day.
function gameSvg(v          , x        , fit                          )                                 {
  const ty = BY + (BH - 5 * FP) / 2
  const lv = `Lv${v.level}`
  const hasCoins = v.coins !== undefined
  // Without coins the level sits level with the figures; with them the three rows share the height.
  const p = hasCoins ? LV_P : FP
  const ly = hasCoins ? 2.5 : ty
  const xy = ly + 5 * p + (hasCoins ? 1.6 : 2.4)
  const cy = xy + 1.6 + 2.4
  const coins = hasCoins ? coinsLabel(v.coins ) : ''
  const cw = hasCoins ? 5 * COIN_P + 2 + textWidth(coins, COIN_P) : 0
  const lw = Math.max(textWidth(lv, p), cw)
  // A gain swaps a row's figure for what it gained (`+10xp`, `+3`), hops it up a pixel and
  // swaps back, while the new part of the XP bar flashes and the coin turns once on its edge.
  const g = v.gain
  const swapped = (steady        , gained                    ) =>
    gained === undefined ? steady : `<g opacity="0">${steady}${gainBeat(false)}</g><g transform="translate(0 0)">${gained}${GAIN_HOP}${gainBeat(true)}</g>`
  const xpGain = g && g.xp > 0 ? (textWidth(`+${coinsLabel(g.xp)}xp`, p) <= lw ? `+${coinsLabel(g.xp)}xp` : `+${coinsLabel(g.xp)}`) : undefined
  const end = v.frac > 0 ? Math.max(1, lw * v.frac) : 0
  const from = g && g.fromFrac <= v.frac ? lw * g.fromFrac : 0
  const flash =
    xpGain && end > from
      ? `<path d="${rect(from, xy - 0.4, n2(Math.max(1, end - from)), 2.4)}" fill="#fff" opacity="0"><animate attributeName="opacity" values="0;0.8;0;0.8;0" keyTimes="0;0.08;0.2;0.32;0.44" calcMode="discrete" dur="${GAIN_MS}ms" fill="freeze"/></path>`
      : ''
  let svg =
    swapped(
      `<path d="${textPixels(lv, 0, ly, p)}" fill="${COLORS.level}"/>`,
      xpGain && `<path d="${textPixels(xpGain, 0, ly, fitP(xpGain, lw, p))}" fill="${COLORS.level}"/>`,
    ) +
    `<path d="${rect(0, xy, n2(lw), 1.6)}" fill="${MUTED}" opacity="0.3"/>` +
    (end > 0 ? `<path d="${rect(0, xy, n2(end), 1.6)}" fill="${COLORS.level}"/>` : '') +
    flash
  if (hasCoins) {
    const coinGain = g && g.coins > 0 ? `+${coinsLabel(g.coins)}` : undefined
    const turns = COIN_TURN.length * 2
    const coin = coinGain
      ? COIN_TURN.map(
          (f, k) =>
            `<g opacity="${k === 0 ? 1 : 0}"><path d="${pixels(f, 0, cy, COIN_P)}" fill="${COLORS.coin}"/><animate attributeName="opacity" values="${Array.from({ length: turns + 1 }, (_, j) => (j % COIN_TURN.length === k ? 1 : 0)).join(';')}" keyTimes="${Array.from({ length: turns + 1 }, (_, j) => n2(j * 0.05)).join(';')}" calcMode="discrete" dur="${GAIN_MS}ms" fill="freeze"/></g>`,
        ).join('')
      : `<path d="${pixels(COIN, 0, cy, COIN_P)}" fill="${COLORS.coin}"/>`
    const tx = 5 * COIN_P + 2
    svg +=
      coin +
      swapped(
        `<path d="${textPixels(coins, tx, cy, COIN_P)}" fill="${MUTED}"/>`,
        coinGain && `<path d="${textPixels(coinGain, tx, cy, fitP(coinGain, lw - tx, COIN_P))}" fill="${COLORS.coin}"/>`,
      )
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
  return { svg: `<g transform="translate(${n2(x)} 0)">${svg}</g>`, width: Math.round(width) }
}

const grid4 = (g          , fill        , ch        , x        , y        ) =>
  `<path d="${pixels(g, x, y, 1.4, ch)}" fill="${fill}"/>`

// Backdrops: a small flat scene behind Clawd, bought in the shop. Each layer is a pixel grid
// standing on the ground (or `up` cells above it), `left` or `right` cells in from that edge,
// so one scene fits both the band's tile and the shop's card.
// Clawd covers the middle, so the things worth seeing sit at the edges and above his head.
// `repeat` layers tile along the whole band behind the figures, so they stay low and dim:
// below the bars (y ≥ 16) or in the top few pixels, and they skip the level cluster and the note.
                                                                                                                                         
const SCENE_P = 2
const SCENE_W = SPRITE_W - 4 // the band's tile, leaving a little air before the level cluster
const GROUND_Y = 22 // Clawd's feet stand on this line, in the band and in the shop alike
const SCENE_OPACITY = 0.5 // on the band the scene stays quiet behind the figures; the shop shows it whole

const PINE = ['..#..', '.###.', '..#..', '.###.', '#####', '.###.', '#####', '..t..']
const PALM = ['.g.g.', 'ggtgg', 'g.t.g', '..t..', '..t..', '...t.', '...t.']
const SCENES                                                                   = {
  forest: {
    sky: '#2f423b',
    ground: '#26352d',
    layers: [
      { grid: ['......####........######..', '...##########...##########', '##########################'], repeat: true, colors: { '#': '#364c43' } },
      { grid: ['y.......', '.....y..', '........', '..y.....'], right: 1, up: 6, p: 1.5, colors: { y: '#c9bd6a' } },
      { grid: PINE, colors: { '#': '#4e705d', t: '#5c4636' } },
      { grid: PINE.slice(2), right: 5, colors: { '#': '#4e705d', t: '#5c4636' } },
      { grid: PINE, right: 1, colors: { '#': '#45664f', t: '#5c4636' } },
    ],
  },
  beach: {
    sky: '#3d5a6c',
    ground: '#b59d78',
    layers: [
      { grid: ['.##.', '####', '####', '.##.'], right: 2, up: 6, colors: { '#': '#d9b25a' } },
      { grid: ['..w......w......w......w..', '##########################'], repeat: true, colors: { '#': '#2f4b5c', w: '#5f8099' } },
      { grid: PALM, colors: { g: '#5f8f6a', t: '#7a5a3c' } },
      { grid: ['..rwr..', '.rwrwr.', 'rwrwrwr', '...p...', '...p...', '...p...'], right: 1, colors: { r: '#c06565', w: '#e2ddd2', p: '#8b9099' } },
    ],
  },
  city: {
    sky: '#232a3d',
    ground: '#2b3142',
    layers: [
      { grid: ['.##', '#..', '#..', '.##'], right: 2, up: 7, colors: { '#': '#d8d0c4' } },
      { grid: ['......#...##...###........', '.....###..##...###...##...', '.....###..##.#.###...##...'], repeat: true, colors: { '#': '#2e364d' } },
      { grid: ['##....', 'w#....', '##.###', '#w.#w#', 'w#.###', '##.w##', '#w.###'], colors: { '#': '#3c4560', w: '#c4a05a' } },
      { grid: ['..####..', '..#w##.#', '#.####.#', '#.##w#ww', 'w.####.#', '#.#w##w#'], right: 0, colors: { '#': '#3c4560', w: '#c4a05a' } },
    ],
  },
  // Sydney: the Opera House's sails on the harbour under a rising moon.
  australia: {
    sky: '#3f4466',
    ground: '#2e3956',
    layers: [
      { grid: ['..w.......w.......w....w..'], up: -1, repeat: true, colors: { w: '#55658a' } },
      { grid: ['.##', '###', '.##'], left: 1, up: 7, colors: { '#': '#d8d0c4' } },
      { grid: ['...#.....', '..##..#..', '.###.##.#', '####s##s#', 'bbbbbbbbb'], right: 0, colors: { '#': '#e2ddd2', s: '#b3ada4', b: '#8a7f74' } },
    ],
  },
  malaysia: {
    sky: '#2c3550',
    ground: '#2a3b33',
    layers: [
      { grid: ['...#....#.....##.....#....', '..###..###....##....###...', '..###..###.##.##....###...'], repeat: true, colors: { '#': '#333e5c' } },
      { grid: ['.##.#', '#....', '#....', '.##..'], up: 7, colors: { '#': '#d9c06a' } },
      { grid: ['.#...#.', '.#...#.', '###.###', '#w#.#w#', '#######', '###.###', '#w#.#w#', '###.###', '#w#.#w#', '###.###'], right: 1, colors: { '#': '#9aa6b8', w: '#d9c06a' } },
      { grid: PALM, colors: { g: '#4f7a5a', t: '#7a5a3c' } },
    ],
  },
  space: {
    sky: '#1b1d2b',
    ground: '#3e4152',
    layers: [
      { grid: ['.......#..........#.....................#..........', '..#.................................#...........#.', '..........#.................#......................', '#..........................................#.......', '.....#..........#..........................#.....#.', '...................................................', '.#.................#.......................#.......', '..........#........................................'], up: 4, p: 1, colors: { '#': '#c8c8d8' } },
      { grid: ['..pppp..', '.pppppp.', 'rrrrrrrr', '.pppppp.', '..pppp..'], right: 1, up: 5, colors: { p: '#8f7fc9', r: '#c4a05a' } },
      { grid: ['..cc.......cc......cc....cc..'], up: -1, repeat: true, colors: { c: '#33364a' } },
      { grid: ['...........#..............................#.........', '..#....................#..........#................', '.................................................#.', '......#.........#..........................#.......', '...........................#.......................', '#..................................................'], up: 8, p: 1, repeat: true, colors: { '#': '#6e6e84' } },
    ],
  },
}

/**
 * A backdrop: landmarks in the box at (x, y), `w` × `h`; sky and ground out to `full`.
 * `repeat` layers fill the box and then run on from `from` (where the band's figures start),
 * leaving the level cluster and the note on plain sky. Each is one `<pattern>` tile, so a wide
 * band costs no more than a narrow one. `hideRight` leaves out the landmarks on the right, where
 * Clawd's thought and clock bubbles go.
 */
function sceneSvg(id        , x        , y        , w        , h        , full = w, from = x + w, hideRight = false)         {
  const s = SCENES[id]
  if (!s) return ''
  // Ids carry the geometry, so two different boxes in one document never share a clip or tile.
  const key = `scene-${id}-${[x, y, w, h, full, from].map(Math.round).join('-')}`.replace(/-(?=-)/g, '-m')
  const defs           = [`<clipPath id="${key}"><rect x="${x}" y="${y}" width="${full}" height="${h}" rx="3"/></clipPath>`]
  const layers = s.layers.map((l, i) => {
    const p = l.p ?? SCENE_P
    const cols = Math.max(...l.grid.map(r => r.length))
    const ly = GROUND_Y - (l.up ?? 0) * SCENE_P - l.grid.length * p
    const paint = (ox        , oy        ) =>
      Object.entries(l.colors)
        .map(([ch, fill]) => `<path d="${pixels(l.grid, ox, oy, p, ch)}" fill="${fill}"/>`)
        .join('')
    if (!l.repeat && hideRight && l.right !== undefined) return ''
    if (!l.repeat) return paint(l.right === undefined ? x + (l.left ?? 0) * SCENE_P : x + w - l.right * SCENE_P - cols * p, ly)
    const tile = `${key}-${i}`
    const th = l.grid.length * p
    defs.push(`<pattern id="${tile}" x="${x}" y="${ly}" width="${cols * p}" height="${th}" patternUnits="userSpaceOnUse">${paint(0, 0)}</pattern>`)
    const run = (a        , b        ) => (b > a ? `<rect x="${n2(a)}" y="${ly}" width="${n2(b - a)}" height="${th}" fill="url(#${tile})"/>` : '')
    return from <= x + w ? run(x, x + full) : run(x, x + w) + run(from, x + full)
  })
  return `<defs>${defs.join('')}</defs>
  <g clip-path="url(#${key})"><rect x="${x}" y="${y}" width="${full}" height="${h}" fill="${s.sky}"/><rect x="${x}" y="${GROUND_Y}" width="${full}" height="${y + h - GROUND_Y}" fill="${s.ground}"/>${layers.join('')}</g>`
}

/** Clawd alone in an outfit, for the shop: `scale` screen pixels per unit. */
function wardrobeSvg(outfit                        , scale        )         {
  const w = 44
  const h = 28
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="-2 -2 ${w} ${h}" shape-rendering="crispEdges">
  ${outfit.scene ? sceneSvg(outfit.scene, -2, -2, w, h) : ''}
  ${clawdSvg('happy', 'idle', outfit, false, false)}
</svg>`
}

const FACES                       = {
  happy: '(^‿^)',
  anxious: '(・_・;)',
  frantic: '(°□°;)',
  panic: '(ﾟДﾟ;)',
  asleep: '(-_-) zZ',
}


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

const BADGES                                                = {
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
}

function newProgress()           {
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
    coins: 0,
    coinTokens: 0,
    owned: [],
    outfit: {},
  }
}

/** The saved progress, with any field an older version didn't keep filled in. */
function progressOf(saved         )           {
  const base = newProgress()
  if (!saved || typeof saved !== 'object') return base
  return { ...base, ...(saved                     ) }
}

/** A change to the progress, the toasts it calls for, and a command's answer. */
                                                           

const stepFrom = (p          )       => ({ p: JSON.parse(JSON.stringify(p)), news: [] })

function earn(step      , id        , day        ) {
  if (step.p.badges[id] || !BADGES[id]) return
  step.p.badges[id] = day
  step.p.xp += XP.badge
  step.p.coins += COINS.badge
  step.news.push(`Badge earned: ${BADGES[id].name}, ${BADGES[id].how} (+${XP.badge} XP, +${COINS.badge} coins)`)
}

                  
             
                                                                                                                               
                                                                
               
 

function afterTurn(prev          , t           )       {
  const step = stepFrom(prev)
  const p = step.p
  const day = dayOf(t.now)
  p.turns += 1
  if (t.usage) {
    p.tokensIn += t.usage.input_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens
    p.tokensOut += t.usage.output_tokens
    // Written tokens become coins, a thousand at a time; the rest waits for the next turn.
    p.coinTokens += t.usage.output_tokens
    const coins = Math.floor(p.coinTokens / COINS.perTokens)
    p.coins += coins
    p.coinTokens -= coins * COINS.perTokens
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

function maxedOut(step      , kind        , day        ) {
  const gain = kind === 'seven_day' ? XP.maxedWeek : kind === 'five_hour' ? XP.maxedSession : 0
  if (gain === 0) return
  step.p.xp += gain
  step.news.push(`Maxed out the ${kind === 'seven_day' ? 'weekly' : 'session'} limit! (+${gain} XP)`)
  earn(step, 'maxed-out', day)
}

// A window has ended: score how it went.
function scoreWindow(step      , kind        , peak        , day        ) {
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
function afterMeasure(prev          , snap          , now        , prevCtx         )       {
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
    // Reaching 100% pays out at once, once per window.
    if (l.pct >= 100 && from < 100) maxedOut(step, l.kind, day)
    p.windows[l.kind] = { resetsAt: l.resetsAt ?? w.resetsAt, peak: Math.max(from, l.pct) }
  }
  if (snap.ctxPct >= 80) earn(step, 'deep-thinker', day)
  if (prevCtx !== undefined && prevCtx > 50 && snap.ctxPct < 10) earn(step, 'fresh-start', day)
  return step
}

function statsOf(p          , now        )         {
  const level = levelOf(p.xp)
  const xp = Math.floor(p.xp)
  const outfit = outfitOf(p, level)
  const worn = SLOTS.flatMap(slot => (outfit[slot] ? [called(outfit[slot])] : []))
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
    `Badges ${earned.length}/${all.length}: ${earned.join(', ') || 'none yet'}`,
    left.length ? `Still to earn: ${left.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The item an argument names, by id or by name (`hard hat`, `the crown`); `none` for everything. */
function itemNamed(arg        )                     {
  const want = arg.trim().toLowerCase().replace(/^the\s+/, '')
  if (want === 'none' || want === 'nothing' || want === 'all' || want === 'everything') return 'none'
  return Object.keys(ITEMS).find(id => id === want || ITEMS[id]?.name.toLowerCase() === want)
}

const unlockLevel = (id        ) => LEVELS.find(m => m.item === id)?.at

function shopOf(p          )         {
  const level = levelOf(p.xp)
  const worn = outfitOf(p, level)
  const line = (slot      ) =>
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
    ...SLOTS.map(slot => `${SLOT_NAMES[slot]}: ${line(slot)}`),
    `/usage-hud buy <item> to buy · wear <item> or remove <item> to change outfits · wear none to take it all off`,
  ].join('\n')
}

function bought(prev          , arg        )       {
  const step = stepFrom(prev)
  const p = step.p
  const level = levelOf(p.xp)
  const id = itemNamed(arg)
  const item = id ? ITEMS[id] : undefined
  if (!id || !item) step.reply = `There's no "${arg}" in the shop. /usage-hud shop lists everything.`
  else if (!item.price) step.reply = `The ${called(id)} isn't for sale: it comes free at level ${unlockLevel(id)}.`
  else if (owns(p, level, id)) step.reply = `You already have the ${called(id)}. /usage-hud wear ${id} puts it on.`
  else if (item.level && level < item.level) step.reply = `The ${called(id)} needs level ${item.level}, and Clawd is level ${level}.`
  else if (p.coins < item.price) step.reply = `The ${called(id)} costs ${item.price.toLocaleString('en-US')} coins and you have ${p.coins.toLocaleString('en-US')}.`
  else {
    p.coins -= item.price
    p.owned.push(id)
    p.outfit[item.slot] = id
    step.reply = `Bought the ${called(id)} for ${item.price.toLocaleString('en-US')} coins, and ${item.slot === 'scene' ? "it's up behind Clawd" : "Clawd's wearing it"}. ${p.coins.toLocaleString('en-US')} coins left.`
  }
  return step
}

function dressed(prev          , arg        )       {
  const step = stepFrom(prev)
  const p = step.p
  const level = levelOf(p.xp)
  const id = itemNamed(arg)
  const item = id ? ITEMS[id] : undefined
  if (id === 'none') {
    // Clothes only: the backdrop stays up until its own card takes it down.
    for (const slot of SLOTS) if (slot !== 'scene') p.outfit[slot] = 'none'
    step.reply = 'Clawd took everything off.'
  } else if (!id || !item) {
    const mine = Object.keys(ITEMS).filter(i => owns(p, level, i)).map(called)
    step.reply = `Clawd can wear: ${mine.join(', ') || 'nothing yet'}. /usage-hud shop has more.`
  } else if (!owns(p, level, id)) {
    step.reply = item.price
      ? `Clawd doesn't have the ${called(id)} yet: it's ${item.price.toLocaleString('en-US')} coins in /usage-hud shop.`
      : `The ${called(id)} unlocks at level ${unlockLevel(id)}.`
  } else {
    p.outfit[item.slot] = id
    step.reply = item.slot === 'scene' ? `Clawd's backdrop is now ${item.name}.` : `Clawd is wearing the ${item.name}.`
  }
  return step
}

function undressed(prev          , arg        )       {
  const step = stepFrom(prev)
  const p = step.p
  const said = arg.trim().toLowerCase().replace(/^the\s+/, '')
  const want = said === 'backdrop' ? 'scene' : said
  const id = itemNamed(want)
  const slot = SLOTS.find(s => s === want) ?? (id && id !== 'none' ? ITEMS[id]?.slot : undefined)
  const on = slot ? outfitOf(p, levelOf(p.xp))[slot] : undefined
  if (!slot || !on || (id && id !== 'none' && id !== on)) {
    step.reply = `Clawd isn't wearing that. /usage-hud stats shows what he has on.`
  } else {
    p.outfit[slot] = 'none'
    step.reply = `Took off the ${called(on)}.`
  }
  return step
}
/** One item on the shop's shelf, and what a press on it does: take off, put on, buy, or nothing yet. */
                                                                                                                                              

function shelfOf(p          )          {
  const level = levelOf(p.xp)
  const worn = outfitOf(p, level)
  return Object.entries(ITEMS).map(([id, item])        => {
    const shelf = { id, name: item.name, slot: item.slot, price: item.price }
    if (worn[item.slot] === id) return { ...shelf, state: 'wearing' }
    if (owns(p, level, id)) return { ...shelf, state: 'owned' }
    if (!item.price) return { ...shelf, state: 'locked', level: unlockLevel(id) }
    if (item.level && level < item.level) return { ...shelf, state: 'locked', level: item.level }
    return { ...shelf, state: p.coins < item.price ? 'short' : 'buy' }
  })
}

/** What a press on an item does, as the text command would: `wear`, `remove` or `buy`. */
const pressOf = (s       ) => (s.state === 'wearing' ? undressed : s.state === 'owned' ? dressed : s.state === 'buy' ? bought : undefined)

window.HUD = { clawdSvg, pixelSvg, tanksOf, wardrobeSvg, sceneSvg, gameSvg, barSvg, noteSvg, noteOf, shortNoteOf, planOf, moodOf, tone, coinsLabel, textWidth, textPixels, pixels, untilReset, tokens, FONT, COIN, SPARKLE, COLORS, SHELLS, TONES, CLAWD, INK, MUTED, ITEMS, LEVELS, SLOTS, SLOT_NAMES, SCENES, SCENE_W, SCENE_P, GROUND_Y, SCENE_OPACITY, FACES, GAIN_MS, SWEEP_MS, SPRITE_W, HEIGHT, PX_PER_COLUMN, REFRESH_W, levelOf, xpFor, fracOf, titleOf, itemsOf, outfitOf, gameViewOf, dayOf, liveStreak, HEADPHONES, NOTE, BODY, EYES, FLAME_A, FLAME_B, ZED, TINY_CRAB, PLANT, PINE, PALM, COIN_TURN, XP, COINS, BADGES, newProgress, progressOf, afterTurn, afterMeasure, shelfOf, pressOf, bought, dressed, undressed, statsOf }
})()
