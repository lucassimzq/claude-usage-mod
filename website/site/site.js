// claude-usage-mod: the site. Every crab, band, outfit and backdrop is drawn by the mod's own
// code (hud.js); this file is the stage around it: state, scroll, motion and the demos.
;(() => {
'use strict'
const H = window.HUD
if (!H) return

// ------------------------------------------------------------------ utilities
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const inv = (a, b, v) => clamp((v - a) / (b - a))
const r2 = n => Math.round(n * 100) / 100
const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  expo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  io: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) },
}
const wait = ms => new Promise(r => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches
const fmt = n => Math.round(n).toLocaleString('en-US')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// The mod's own strings name the mascot; this page calls him the crab.
const clean = s => String(s).replace(/^Clawd's/, "The crab's").replace(/^Clawd\b/, 'The crab').replace(/\bClawd's/g, "the crab's").replace(/\bClawd\b/g, 'the crab')
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('cum:' + k)) } catch { return null } },
  set(k, v) { try { localStorage.setItem('cum:' + k, JSON.stringify(v)) } catch {} },
}

let vw = innerWidth, vh = innerHeight, sy = scrollY, vel = 0
const tickers = new Set()
let lastT = performance.now(), lastSy = sy
function frame(now) {
  const dt = Math.min(.05, Math.max(.001, (now - lastT) / 1000))
  lastT = now
  sy = scrollY
  vel = lerp(vel, (sy - lastSy) / dt, 1 - Math.exp(-dt * 10))
  lastSy = sy
  if (pending) flush()
  for (const f of tickers) {
    try { f(dt, now / 1000) } catch (e) { console.error(e); tickers.delete(f) }
  }
  requestAnimationFrame(frame)
}
addEventListener('resize', () => { vw = innerWidth; vh = innerHeight; fire('resize') })

// Who is on screen: work for a section runs only while it's near the viewport.
const near = new WeakMap()
const io = new IntersectionObserver(es => es.forEach(e => near.set(e.target, e.isIntersecting)), { rootMargin: '25% 0px 25% 0px' })
const watch = el => { near.set(el, false); io.observe(el); return el }
const isNear = el => near.get(el) === true

const listeners = {}
const on = (k, f) => (listeners[k] ||= new Set()).add(f)
const fire = (k, v) => listeners[k]?.forEach(f => f(v))

// ------------------------------------------------------------------ sound: tiny square-wave blips, off by default
const Sound = {
  on: !!store.get('sound'),
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  },
  tone(f, dur, { type = 'square', vol = .045, slide = 0, delay = 0 } = {}) {
    if (!this.on) return
    const c = this.ensure()
    if (!c) return
    const t = c.currentTime + delay
    const o = c.createOscillator(), g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + .006)
    g.gain.exponentialRampToValueAtTime(.0001, t + dur)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + dur + .02)
  },
  blip() { this.tone(880, .05, { vol: .025 }) },
  coin() { this.tone(988, .06, { vol: .035 }); this.tone(1319, .22, { delay: .06, vol: .035 }) },
  hop() { this.tone(330, .09, { type: 'triangle', slide: 330, vol: .07 }) },
  level() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, .11, { delay: i * .07, vol: .03 })) },
  tick() { this.tone(2000 + Math.random() * 600, .012, { vol: .01 }) },
  thud() { this.tone(140, .14, { type: 'triangle', slide: -60, vol: .09 }) },
  whoosh() { this.tone(200, .25, { type: 'sawtooth', slide: 600, vol: .012 }) },
}
const soundBtn = $('#soundBtn')
const syncSoundBtn = () => soundBtn.setAttribute('aria-pressed', String(Sound.on))
soundBtn.addEventListener('click', () => {
  Sound.on = !Sound.on
  store.set('sound', Sound.on)
  syncSoundBtn()
  if (Sound.on) { Sound.ensure(); Sound.coin() }
})
syncSoundBtn()

// ------------------------------------------------------------------ the band's pixel font, extended to every capital
const UPPER = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  '-': ['...', '...', '###', '...', '...'], '!': ['#', '#', '#', '.', '#'], ':': ['.', '#', '.', '#', '.'],
  '·': ['.', '.', '#', '.', '.'], '/': ['..#', '..#', '.#.', '#..', '#..'], ',': ['.', '.', '.', '#', '#'],
  "'": ['#', '#', '.', '.', '.'], '?': ['##.', '..#', '.#.', '...', '.#.'], '×': ['...', '#.#', '.#.', '#.#', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'], ' ': ['..', '..', '..', '..', '..'],
}
H.FONT.g = ['.##', '#.#', '.##', '..#', '##.'] // so a band tag can say "pg"
const glyphOf = ch => H.FONT[ch] ?? UPPER[ch] ?? UPPER[ch.toUpperCase()] ?? UPPER[' ']
function pixD(str, p = 1, x0 = 0, y0 = 0, track = 1) {
  let d = '', x = x0
  for (const ch of String(str)) {
    const g = glyphOf(ch)
    const w = Math.max(...g.map(r => r.length))
    g.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '#') d += `M${r2(x + i * p)} ${r2(y0 + y * p)}h${p}v${p}h-${p}z`
    })
    x += (w + track) * p
  }
  return { d, w: Math.max(0, x - x0 - track * p), h: 5 * p }
}
function pixSvg(str, fill = 'currentColor', extra = '') {
  const { d, w } = pixD(str)
  return `<svg viewBox="0 0 ${w} 5" width="${w}" height="5" shape-rendering="crispEdges" aria-hidden="true" ${extra}><path d="${d}" fill="${fill}"/></svg>`
}
const gridD = (g, ch = '#', p = 1, ox = 0, oy = 0) => H.pixels(g, ox, oy, p, ch)
const mixHex = (a, b, t) => {
  const c = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const x = c(a), y = c(b)
  return `#${x.map((v, i) => Math.round(lerp(v, y[i], t)).toString(16).padStart(2, '0')).join('')}`
}
const COIN_SVG = `<svg viewBox="0 0 5 5" shape-rendering="crispEdges" aria-hidden="true"><path d="${gridD(H.COIN)}" fill="${H.COLORS.coin}"/></svg>`

// ------------------------------------------------------------------ the demo: one crab for the whole page
const T0 = Date.now()
const st = {
  ctx: 22, s5: 31, s7: 18, usd: 3.17,
  reset5: T0 + 111 * 60_000,
  reset7: T0 + 2.2 * 86_400_000,
  prev: null,          // the snapshot new cells flash from
  doing: 'idle',
  p: null,             // the mod's Progress
  burst: false,
  gain: null,
  tools: 0,
  hidden: false,       // /usage-hud hide
}
const iso = ms => new Date(ms).toISOString()
function snapNow() {
  return {
    ctxPct: Math.round(st.ctx), ctxTokens: Math.round(st.ctx * 10_000), ctxWindow: 1_000_000,
    limits: [
      { kind: 'five_hour', pct: Math.round(st.s5), resetsAt: iso(st.reset5) },
      { kind: 'seven_day', pct: Math.round(st.s7), resetsAt: iso(st.reset7) },
    ],
    usd: st.usd,
  }
}
function startProgress() {
  const p = H.newProgress()
  const day = H.dayOf(Date.now())
  p.xp = Math.round(H.xpFor(12) + .35 * (H.xpFor(13) - H.xpFor(12)))
  p.coins = 2400
  p.turns = 640
  p.tokensIn = 48_200_000
  p.tokensOut = 1_910_000
  p.streak = { count: 12, best: 21, lastDay: day, restDays: 1 }
  p.today = { day, turns: 14 }
  p.badges = { 'on-a-roll': day }
  p.windows = { five_hour: { resetsAt: iso(st.reset5), peak: st.s5 }, seven_day: { resetsAt: iso(st.reset7), peak: st.s7 } }
  // He starts bare, headphones on; the level unlocks wait in the shop.
  p.outfit = { head: 'none', face: 'none', neck: 'none' }
  return p
}
{
  const saved = store.get('progress')
  st.p = startProgress()
  if (saved && typeof saved === 'object') {
    for (const k of ['xp', 'coins', 'owned', 'outfit', 'badges', 'turns', 'tokensOut', 'coinTokens']) if (saved[k] !== undefined) st.p[k] = saved[k]
  }
}
const save = () => store.set('progress', { xp: st.p.xp, coins: st.p.coins, owned: st.p.owned, outfit: st.p.outfit, badges: st.p.badges, turns: st.p.turns, tokensOut: st.p.tokensOut, coinTokens: st.p.coinTokens })

const viewOf = () => H.gameViewOf(st.p, Date.now(), st.burst, st.gain || undefined)
const outfitNow = () => viewOf().outfit
const worstPct = () => Math.max(st.ctx, st.s5, st.s7)
const moodNow = () => H.moodOf(worstPct())

let pending = 0 // 1: redraw, 2: redraw and replay the flashes
function emit(restart = false) { pending = Math.max(pending, restart ? 2 : 1) }
function flush() {
  const restart = pending === 2
  pending = 0
  for (const b of bands) drawBand(b, restart)
  fire('state', { restart })
}

let gainTimer = 0, burstTimer = 0
function toastLevel(was, is) {
  const unlock = H.LEVELS.filter(m => m.at > was && m.at <= is && m.item).pop()?.item
  toast(`The crab reached level ${is}: ${H.titleOf(is)}${unlock ? `, ${H.ITEMS[unlock].name} unlocked` : ''} (+${H.COINS.level * (is - was)} coins)`, 'level')
}
// The mod's play(): apply one change, add level-up coins, and play what it earned on the band.
function apply(step, opts = {}) {
  const before = st.p
  const p = step.p
  const was = H.levelOf(before.xp), is = H.levelOf(p.xp)
  p.coins += H.COINS.level * Math.max(0, is - was)
  const xp = Math.max(0, p.xp - before.xp), coins = Math.max(0, p.coins - before.coins)
  st.p = p
  if (xp > 0 || coins > 0) {
    st.gain = {
      xp: (st.gain?.xp ?? 0) + xp,
      coins: (st.gain?.coins ?? 0) + coins,
      fromFrac: is > was ? 0 : (st.gain?.fromFrac ?? H.fracOf(before.xp)),
    }
    clearTimeout(gainTimer)
    gainTimer = setTimeout(() => { st.gain = null; emit() }, H.GAIN_MS + 200)
    fire('gain', { xp, coins })
  }
  if (is > was) {
    st.burst = true
    clearTimeout(burstTimer)
    burstTimer = setTimeout(() => { st.burst = false; emit() }, 2600)
    toastLevel(was, is)
    Sound.level()
    fire('level', is)
  }
  for (const line of step.news) toast(clean(line), /Badge/.test(line) ? 'badge' : /Maxed/.test(line) ? 'level' : 'crab')
  if (step.news.some(n => /Badge/.test(n))) fire('badges')
  if (step.reply && opts.say !== false) toast(clean(step.reply), 'crab')
  emit(true)
  save()
  fire('progress')
}

// A new reading: the bars move, new cells flash, limits that cross 50, 80 or 95 get a toast.
let settleTimer = 0
function measure(next, opts = {}) {
  const before = snapNow()
  const prevCtx = st.ctx
  const old = { five_hour: st.s5, seven_day: st.s7 }
  if (next.ctx !== undefined) st.ctx = clamp(Math.round(next.ctx), 0, 100)
  if (next.s5 !== undefined) st.s5 = clamp(Math.round(next.s5), 0, 100)
  if (next.s7 !== undefined) st.s7 = clamp(Math.round(next.s7), 0, 100)
  if (next.reset5) st.reset5 = next.reset5
  st.prev = before
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => { st.prev = null; emit() }, H.SWEEP_MS + 600)
  if (opts.toasts !== false) {
    for (const [kind, name, now] of [['five_hour', 'Session', st.s5], ['seven_day', 'Weekly', st.s7]]) {
      const crossed = [50, 80, 95].filter(w => old[kind] < w && now >= w).pop()
      if (crossed) toast(`The crab is sweating: ${name} limit passed ${crossed}%`, 'sweat')
    }
  }
  if (opts.game !== false) apply(H.afterMeasure(st.p, snapNow(), opts.at ?? Date.now(), prevCtx))
  else emit(true)
  fire('measure')
}

// ------------------------------------------------------------------ toasts
const ICONS = {
  crab: () => `<svg viewBox="6 3 30 22" shape-rendering="crispEdges">${H.clawdSvg('happy', 'idle', {}, false, false)}</svg>`,
  sweat: () => `<svg viewBox="2 3 32 22" shape-rendering="crispEdges">${H.clawdSvg('frantic', 'idle', {}, false, false)}</svg>`,
  coin: () => COIN_SVG,
  level: () => `<svg viewBox="0 0 3 3" shape-rendering="crispEdges"><path d="${gridD(H.SPARKLE)}" fill="${H.COLORS.shine}"/></svg>`,
  badge: () => `<svg viewBox="0 0 5 5" shape-rendering="crispEdges"><path d="${gridD(['.###.', '#####', '#####', '.###.', '.#.#.'])}" fill="${H.COLORS.golden}"/></svg>`,
}
const appEl = $('#app')
const tryEl = watch($('#try'))
function toast(text, icon = 'crab', ms = 3600) {
  const inApp = appEl && isNear(tryEl) && (() => { const r = appEl.getBoundingClientRect(); return r.top < vh - 80 && r.bottom > 120 })()
  const host = inApp ? $('#appToasts') : $('#toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.innerHTML = `${(ICONS[icon] || ICONS.crab)()}<span>${esc(text)}</span>`
  host.appendChild(el)
  while (host.children.length > 3) host.firstElementChild.remove()
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380) }, ms)
}

// ------------------------------------------------------------------ bands: the mod's pixelSvg, live
const bands = []
const ro = new ResizeObserver(es => es.forEach(e => { const b = bands.find(b => b.el === e.target); if (b) drawBand(b, false) }))
function addBand(el, opts) {
  const b = { el, ...opts }
  bands.push(b)
  ro.observe(el)
  return b
}
function drawBand(b, restart) {
  const cw = b.el.clientWidth
  if (!cw) return
  const k = b.k()
  b.el.style.setProperty('--k', k)
  const width = Math.max(140, Math.floor(cw / k))
  const view = b.view ? b.view() : viewOf()
  const doing = b.doing ? b.doing() : 'idle'
  const cur = snapNow()
  const list = H.tanksOf(cur, st.prev ?? cur, Date.now())
  let svg = st.hidden && b.hideable
    ? `<svg viewBox="0 0 ${width} 24" width="${width}" height="24"></svg>`
    : H.pixelSvg(list, b.usd === false ? undefined : st.usd, doing, width, view)
  svg = svg.replace('<g transform="translate(8 5)">', '<g class="crab-slot" transform="translate(8 5)">')
  const old = b.el.firstElementChild
  let t = 0
  try { if (old && !restart && old.getCurrentTime) t = old.getCurrentTime() } catch {}
  b.el.innerHTML = svg
  const ns = b.el.firstElementChild
  try { if (t && ns.setCurrentTime) ns.setCurrentTime(t) } catch {}
  if (REDUCED) try { ns.pauseAnimations() } catch {}
  b.width = width
  b.k_ = k
  b.list = list
  b.onDraw?.(b, view, list)
}

// ------------------------------------------------------------------ the sprite reader: the mod's SVG, as rects with their SMIL
// Used by the WebGL crab (voxel.js), the coin bursts and the footer.
function smilOf(el) {
  const num = s => parseFloat(s)
  const secs = s => (!s ? 0 : s.endsWith('ms') ? num(s) / 1000 : num(s))
  const out = []
  for (const a of el.children) {
    const tag = a.tagName
    if (tag !== 'animate' && tag !== 'animateTransform') continue
    const values = (a.getAttribute('values') || '').split(';').map(v => v.trim())
    const keys = (a.getAttribute('keyTimes') || values.map((_, i) => i / Math.max(1, values.length - 1)).join(';')).split(';').map(Number)
    out.push({
      attr: tag === 'animateTransform' ? 'translate' : a.getAttribute('attributeName'),
      values: tag === 'animateTransform' ? values.map(v => v.split(/[\s,]+/).map(Number)) : values.map(Number),
      keys,
      dur: secs(a.getAttribute('dur')),
      begin: secs(a.getAttribute('begin')),
      repeat: a.getAttribute('repeatCount') === 'indefinite',
      freeze: a.getAttribute('fill') === 'freeze',
    })
  }
  return out
}
function smilAt(an, t) {
  const local = t - an.begin
  if (local < 0 || !an.dur) return undefined
  let f
  if (an.repeat) f = (local % an.dur) / an.dur
  else if (local >= an.dur) return an.freeze ? an.values[an.values.length - 1] : undefined
  else f = local / an.dur
  let i = 0
  while (i + 1 < an.keys.length && an.keys[i + 1] <= f + 1e-9) i++
  return an.values[i]
}
function parseSprite(frag) {
  const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${frag}</svg>`, 'image/svg+xml')
  const rects = []
  const nodeOf = el => {
    const tr = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(el.getAttribute('transform') || '')
    const op = el.getAttribute('opacity')
    return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, op: op === null ? 1 : +op, anims: smilOf(el) }
  }
  const walk = (el, chain) => {
    for (const c of el.children) {
      const tag = c.tagName
      if (tag === 'g') walk(c, [...chain, nodeOf(c)])
      else if (tag === 'path') {
        const fill = c.getAttribute('fill')
        if (!fill || fill === 'none' || fill.startsWith('url')) continue
        const node = nodeOf(c)
        const re = /M([-\d.]+) ([-\d.]+)h([-\d.]+)v([-\d.]+)h-[-\d.]+z/g
        const d = c.getAttribute('d') || ''
        let m
        const k = [...chain, node]
        while ((m = re.exec(d))) rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], fill, chain: k })
      }
    }
  }
  walk(doc.documentElement, [])
  return rects
}
// Where a rect is and whether it shows at time t (seconds), by its ancestors' SMIL.
function rectAt(r, t) {
  let x = r.x, y = r.y, vis = 1
  for (const n of r.chain) {
    let tx = n.tx, ty = n.ty, op = n.op
    for (const an of n.anims) {
      const v = smilAt(an, t)
      if (v === undefined) continue
      if (an.attr === 'translate') { tx = v[0]; ty = v[1] ?? 0 } else if (an.attr === 'opacity') op = v
    }
    x += tx; y += ty; vis *= op
  }
  return { x, y, vis }
}

// ------------------------------------------------------------------ nav: the page itself is a gauge
const nav = $('#nav'), readHud = $('#readHud')
$('#brandMark').innerHTML = `<svg viewBox="6 2 30 22" shape-rendering="crispEdges" aria-hidden="true">${H.clawdSvg('happy', 'idle', {}, false, false)}</svg>`
let readPct = -1, readKey = ''
function drawRead() {
  const max = document.documentElement.scrollHeight - vh
  const pct = max > 0 ? Math.round(clamp(sy / max) * 100) : 0
  const outfit = { ...outfitNow() }
  delete outfit.scene
  const key = pct + JSON.stringify(outfit)
  if (key === readKey) return
  readKey = key
  const list = [{ tag: 'pg', pct, from: pct, name: 'page', tip: '' }]
  const old = readHud.firstElementChild
  let t = 0
  try { t = old?.getCurrentTime?.() ?? 0 } catch {}
  readHud.innerHTML = H.pixelSvg(list, undefined, 'idle', 168, { level: 0, frac: 0, streak: 0, outfit }).replace(/<path d="[^"]*" fill="#8b9099" opacity="0.3"\/>/, '')
  try { if (t) readHud.firstElementChild.setCurrentTime(t) } catch {}
  readHud.setAttribute('aria-label', `Page read: ${pct}%`)
  if (pct !== readPct) { readPct = pct; fire('read', pct) }
}
const navLinks = $$('.index a')
tickers.add(() => {
  nav.classList.toggle('scrolled', sy > 8)
  drawRead()
})
const sections = ['try', 'moods', 'levels', 'shop', 'backdrops', 'install'].map(id => document.getElementById(id))
setInterval(() => {
  const mid = vh * .4
  let cur = null
  for (const s of sections) { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) cur = s.id }
  navLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur))
}, 250)

// ------------------------------------------------------------------ hero
const hero = $('#hero'), heroStage = $('#heroStage'), heroBandEl = $('#heroBand')
const heroBand = addBand(heroBandEl, { k: () => (vw < 700 ? 1.25 : 1.5), hideable: true })
function drawHeroFallback() {
  const o = { ...outfitNow() }
  delete o.scene
  $('#heroFallback').innerHTML = `<svg viewBox="-4 -6 52 34" shape-rendering="crispEdges" aria-hidden="true">${H.clawdSvg(moodNow(), 'idle', o, st.burst, true)}</svg>`
}
drawHeroFallback()
on('state', () => {
  if (!hero.classList.contains('gl-on')) drawHeroFallback()
  const hl = $('#heroHl')
  hl.style.setProperty('--fill', Math.max(4, st.s5))
  hl.style.setProperty('--tone', `var(--${H.tone(st.s5) === 'ok' ? 'ok' : H.tone(st.s5) === 'warn' ? 'warn' : 'hot'})`)
})
let heroBusy = 0
function heroTurn() {
  const now = Date.now()
  if (now - heroBusy < 260) return
  heroBusy = now
  $('#stageHint').style.opacity = '0'
  if (st.s5 >= 100 || st.s7 >= 100) {
    toast(`He's asleep until the limit resets, in ${H.untilReset((st.s7 >= 100 ? st.reset7 : st.reset5) - now)}. Reset it in the demo below.`, 'crab')
    fire('poke')
    return
  }
  Sound.hop()
  fire('hop')
  const out = Math.round(rand(1100, 2600))
  st.tools += 1
  apply(H.afterTurn(st.p, { now, usage: { input_tokens: 3000, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, tools: st.tools }), { say: false })
  measure({ ctx: st.ctx + 1, s5: st.s5 + 3, s7: st.s7 + (Math.random() < .5 ? 1 : 0) })
  if (st.s5 >= 50 && !heroStage.dataset.told) { heroStage.dataset.told = '1'; toast('Every click is a turn. Keep going and watch him get nervous.', 'crab') }
}
heroStage.addEventListener('click', heroTurn)
heroStage.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); heroTurn() } })
$$('.refresh').forEach(b => b.addEventListener('click', () => {
  b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin')
  toast('Usage refreshed', 'crab', 1500)
  measure({}, { toasts: false, game: false })
}))

// ------------------------------------------------------------------ marquee
{
  const items = ['CTX', '5H', '7D', 'FIVE MOODS', 'LEVELS', 'STREAKS', '13 BADGES', 'COINS', '30 ITEMS', '6 BACKDROPS', 'SHARED ACROSS SESSIONS', 'UPDATES ITSELF', 'TERMINAL + DESKTOP']
  const sep = i => (i % 3 === 0
    ? `<svg viewBox="6 3 30 22" shape-rendering="crispEdges" style="height:22px">${H.clawdSvg('happy', 'idle', {}, false, false)}</svg>`
    : i % 3 === 1 ? `<svg viewBox="0 0 5 5" style="height:14px" shape-rendering="crispEdges"><path d="${gridD(H.COIN)}" fill="${H.COLORS.coin}"/></svg>`
      : `<svg viewBox="0 0 4 4" style="height:14px" shape-rendering="crispEdges"><path d="${gridD(H.FLAME_A, 'r')}" fill="${H.COLORS.flameOut}"/><path d="${gridD(H.FLAME_A, 'y')}" fill="${H.COLORS.flameIn}"/></svg>`)
  const colors = ['#efebe4', '#8b9099']
  const one = items.map((s, i) => `<span class="marquee-item">${pixSvg(s, colors[i % 2]).replace('<svg ', '<svg style="height:20px" ')}${sep(i)}</span>`).join('')
  const track = $('#marquee')
  track.innerHTML = one + one
  let x = 0, dir = 1
  const mq = watch($('.marquee'))
  tickers.add(dt => {
    if (!isNear(mq) || REDUCED) return
    const half = track.scrollWidth / 2
    if (Math.abs(vel) > 40) dir = vel > 0 ? 1 : -1
    x -= dir * (60 + Math.min(900, Math.abs(vel) * .6)) * dt
    if (x <= -half) x += half
    if (x > 0) x -= half
    track.style.transform = `translate3d(${r2(x)}px,0,0)`
  })
}

// ------------------------------------------------------------------ 01 try it: the app window
const convo = $('#convo'), convoEmpty = $('#convoEmpty'), input = $('#promptInput'), sendBtn = $('#sendBtn')
let manualDoing = null
const appBand = addBand($('#appBand'), {
  k: () => (vw < 700 ? 1.15 : 1.4),
  doing: () => manualDoing ?? st.doing,
  hideable: true,
  onDraw: (b, view, list) => ladder(b.width, view, list),
})
function ladder(width, view, list) {
  const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
  const sizes = view ? { full: H.gameSvg(view, 0, 'full').width, short: H.gameSvg(view, 0, 'short').width } : undefined
  const plan = H.planOf(width, list, st.usd, worst, sizes)
  const long = H.noteOf(worst), short = H.shortNoteOf(worst)
  const set = (k, state) => { const li = $(`#ladder [data-k="${k}"]`); li.classList.toggle('off', state === 'off'); li.style.opacity = state === 'na' ? '.35' : '' }
  set('streak', plan.game === 'full' && view.streak >= 3 ? 'on' : 'off')
  set('cluster', plan.game !== 'none' ? 'on' : 'off')
  set('note', !long ? 'na' : plan.note === long ? 'on' : 'off')
  set('cost', plan.showUsd ? 'on' : 'off')
  set('short', !short ? 'na' : plan.note === long ? 'na' : plan.note === short ? 'on' : 'off')
  set('bars', plan.mode === 'bars' ? 'on' : 'off')
  set('all', plan.mode !== 'tiny' ? 'on' : 'off')
  $('#fitPx').textContent = `${width} px`
}
const SUGGEST = ['Fix the flaky login test', 'Refactor the auth module', 'Write tests for the parser', 'Why does this crash?']
$('#chips').innerHTML = SUGGEST.map(s => `<button class="chip" type="button">${esc(s)}</button>`).join('')
$$('#chips .chip').forEach(c => c.addEventListener('click', () => send(c.textContent)))
const REPLIES = [
  [/flaky|fix|bug/i, 'Edit tests/login.spec.ts', 'Found it. The test raced the session timer, so it now waits for the redirect. It passed 50 runs in a row.'],
  [/refactor|clean/i, 'Edit src/auth/session.ts', 'Split the session store out of the auth module and kept the public API the same. All 42 tests still pass.'],
  [/test|parser|spec/i, 'Write tests/parser.test.ts', 'Added 18 cases for the parser, including an empty file and an unclosed string. One of them caught a real bug, which I fixed.'],
  [/why|crash|error|stack|explain/i, 'Read logs/crash.txt', 'The retry loop never resets its counter, so the fourth retry reads a closed socket. The fix is one line in net/retry.ts.'],
  [/hi|hello|hey|crab/i, 'Read README.md', "Hi! These replies are canned, but the crab is real. Watch the bars under this message."],
  [/./, 'Read src/index.ts', 'Done. I kept the change small and noted in the PR what to check before merging.'],
]
let busy = false
function addMsg(kind, html) {
  convoEmpty.hidden = true
  const el = document.createElement('div')
  el.className = `msg ${kind}`
  el.innerHTML = html
  convo.appendChild(el)
  const msgs = $$('.msg', convo)
  if (msgs.length > 6) msgs[0].remove()
  return el
}
function setDoing(d) { st.doing = d; manualDoing = null; syncSeg(); emit(); fire('doing', d) }
async function command(text) {
  const [, verb = ''] = text.trim().split(/\s+/)
  addMsg('user', esc(text))
  await wait(250)
  if (/^stats$/i.test(verb)) {
    addMsg('bot', `<div class="tool"><i></i><b>/usage-hud stats</b></div>${esc(clean(H.statsOf(st.p, Date.now()))).replace(/\n/g, '<br>')}`)
  } else if (/^shop$|^wear$|^buy$/i.test(verb)) {
    addMsg('bot', 'Opening the shop below.')
    await wait(400); $('#shop').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' })
  } else if (/^update$/i.test(verb)) {
    addMsg('bot', 'Checking GitHub for a newer tag. See how it installs below.')
    await wait(400); $('#hood').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' })
  } else {
    st.hidden = /^hide$/i.test(verb) ? true : /^show$/i.test(verb) ? false : !st.hidden
    addMsg('bot', st.hidden ? 'Band hidden. <code>/usage-hud</code> brings it back.' : 'Band shown.')
    emit()
  }
}
async function send(text) {
  text = String(text || '').trim()
  if (!text || busy) return
  input.value = ''
  hideMenu()
  if (/^\/usage-hud\b/i.test(text)) return command(text)
  busy = true
  sendBtn.disabled = true
  addMsg('user', esc(text))
  Sound.blip()
  if (st.s5 >= 100 || st.s7 >= 100) {
    await wait(500)
    addMsg('bot', `You've hit your ${st.s7 >= 100 ? 'weekly' : '5-hour'} limit, so Claude can't reply until it resets in ${H.untilReset((st.s7 >= 100 ? st.reset7 : st.reset5) - Date.now())}. The crab is asleep. Press <b>Reset the 5-hour window</b> to wake him.`)
    busy = false; sendBtn.disabled = false
    return
  }
  setDoing('thinking')
  await wait(rand(1100, 1700))
  setDoing('typing')
  const [, tool, reply] = REPLIES.find(([re]) => re.test(text))
  const el = addMsg('bot', `<div class="tool"><i></i><b>${esc(tool)}</b></div><span class="txt"></span><span class="cursor"></span>`)
  const txt = $('.txt', el)
  const words = reply.split(' ')
  for (let i = 0; i < words.length; i++) {
    txt.textContent += (i ? ' ' : '') + words[i]
    if (i % 2 === 0) Sound.tick()
    await wait(REDUCED ? 0 : rand(28, 70))
  }
  $('.cursor', el)?.remove()
  setDoing('idle')
  // The reply's usage: the context grows, both limits move, and the turn pays out.
  const out = Math.round(rand(1800, 3600))
  st.tools += Math.round(rand(1, 4))
  st.usd = Math.round((st.usd + rand(.08, .32)) * 100) / 100
  apply(H.afterTurn(st.p, { now: Date.now(), usage: { input_tokens: 24_000, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, tools: st.tools }), { say: false })
  measure({ ctx: st.ctx + rand(3, 7), s5: st.s5 + rand(5, 11), s7: st.s7 + rand(1, 3) })
  busy = false
  sendBtn.disabled = false
}
$('#promptForm').addEventListener('submit', e => { e.preventDefault(); send(input.value) })
// A slash brings up the mod's commands, as in Claude Code.
const CMDS = [['/usage-hud', 'hide or show the band'], ['/usage-hud stats', 'level, XP, streak, coins'], ['/usage-hud shop', 'open the shop'], ['/usage-hud update', 'check for a new version']]
const menu = document.createElement('div')
menu.className = 'cmd-menu'
menu.hidden = true
menu.setAttribute('role', 'listbox')
$('#promptForm').before(menu)
function hideMenu() { menu.hidden = true }
input.addEventListener('input', () => {
  const v = input.value
  if (!v.startsWith('/')) return hideMenu()
  const hits = CMDS.filter(([c]) => c.startsWith(v.split(' ')[0]) || v.startsWith(c))
  if (!hits.length) return hideMenu()
  menu.innerHTML = hits.map(([c, d]) => `<button type="button" role="option" data-cmd="${c}"><b>${c}</b><span>${d}</span></button>`).join('')
  menu.hidden = false
  $$('button', menu).forEach(b => b.addEventListener('click', () => send(b.dataset.cmd)))
})
input.addEventListener('blur', () => setTimeout(hideMenu, 150))

// Sliders, activity, the window's width
const sliders = [['ctx', 'r-ctx', 'o-ctx'], ['s5', 'r-5h', 'o-5h'], ['s7', 'r-7d', 'o-7d']]
function syncSliders() {
  for (const [k, id, oid] of sliders) {
    const r = $('#' + id), o = $('#' + oid)
    const v = Math.round(st[k])
    if (document.activeElement !== r) r.value = v
    const tone = `var(--${H.tone(v)})`
    r.style.setProperty('--pct', `${v}%`)
    r.style.setProperty('--tone', tone)
    o.textContent = `${v}%`
    o.style.setProperty('--tone', tone)
  }
}
for (const [k, id] of sliders) {
  $('#' + id).addEventListener('input', e => {
    st[k] = +e.target.value
    if (k === 's5' && st.p.windows.five_hour) st.p.windows.five_hour.peak = Math.max(st.p.windows.five_hour.peak, st.s5)
    st.prev = null
    emit()
    fire('measure')
  })
}
function syncSeg() { $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.doing === (manualDoing ?? st.doing)))) }
$$('.seg button').forEach(b => b.addEventListener('click', () => { manualDoing = b.dataset.doing; st.doing = b.dataset.doing; syncSeg(); emit(); fire('doing', st.doing) }))
on('state', syncSliders)
$('#maxBtn').addEventListener('click', () => {
  if (st.s5 >= 100) return toast('Already maxed. He is asleep until the window resets.', 'crab')
  measure({ s5: 100 })
})
$('#resetBtn').addEventListener('click', () => {
  const oldReset = st.reset5
  const next = Date.now() + 5 * 3600_000
  // Score the window that just ended the way the mod does when its reset time passes.
  measure({ s5: 0, reset5: next }, { at: Math.max(Date.now(), oldReset + 1000) })
  toast('A new 5-hour window starts at 0%.', 'crab')
})
{
  const handle = $('#resize'), holder = $('#appHolder')
  let w = null, sx = 0, sw = 0
  const setW = px => {
    const max = holder.clientWidth
    w = clamp(Math.round(px), 220, max)
    appEl.style.width = w >= max - 1 ? '' : `${w}px`
    handle.setAttribute('aria-valuenow', String(w))
    handle.setAttribute('aria-valuemax', String(max))
    $('#widthPx').textContent = fmt(appEl.offsetWidth)
  }
  handle.addEventListener('pointerdown', e => { handle.setPointerCapture(e.pointerId); handle.classList.add('drag'); sx = e.clientX; sw = appEl.offsetWidth; e.preventDefault() })
  handle.addEventListener('pointermove', e => { if (handle.hasPointerCapture(e.pointerId)) setW(sw + (e.clientX - sx)) })
  const end = e => { handle.classList.remove('drag'); try { handle.releasePointerCapture(e.pointerId) } catch {} }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? 80 : 20
    if (e.key === 'ArrowLeft') { setW(appEl.offsetWidth - step); e.preventDefault() }
    if (e.key === 'ArrowRight') { setW(appEl.offsetWidth + step); e.preventDefault() }
  })
  new ResizeObserver(() => { $('#widthPx').textContent = fmt(appEl.offsetWidth) }).observe(appEl)
  // A hint: the window narrows once on its own when it first comes into view, then springs back.
  let shown = false
  new IntersectionObserver(es => {
    if (shown || REDUCED || !es[0].isIntersecting) return
    shown = true
    const max = holder.clientWidth, to = Math.max(300, max * .46)
    const t0 = performance.now()
    const run = now => {
      const t = (now - t0) / 2600
      if (t >= 1 || w !== null) { if (w === null) appEl.style.width = ''; return }
      const k = t < .45 ? ease.io(t / .45) : t < .6 ? 1 : 1 - ease.io((t - .6) / .4)
      appEl.style.width = `${lerp(max, to, k)}px`
      requestAnimationFrame(run)
    }
    setTimeout(() => requestAnimationFrame(run), 500)
  }, { threshold: .55 }).observe(appEl)
}

// ------------------------------------------------------------------ 02 moods: scroll fills the weekly limit
{
  const sec = watch($('#moods'))
  const crabEl = $('#moodsCrab'), pctEl = $('#moodsPct'), barEl = $('#moodsBar')
  const nameEl = $('#moodsName'), descEl = $('#moodsDesc'), rangeEl = $('#moodsRange'), noteEl = $('#moodsNote')
  const steps = $$('#moodsSteps li')
  const MOODS = {
    happy: ['Vibing.', 'Under 50%', 'Headphones on, tapping a foot, music notes drifting up.'],
    anxious: ['Getting nervous.', '50% and up', 'Sipping coffee a little too fast, with a note saying which limit is filling up.'],
    frantic: ['Frantic.', '80% and up', 'Watching the clock tick.'],
    panic: ['This is fine.', '95% and up', 'Coffee in hand, flames either side.'],
    asleep: ['Out cold.', '100%', 'Asleep until the limit resets, and the note says when. Maxing out still pays: +150 XP and the Maxed Out badge.'],
  }
  const ORDER = ['happy', 'anxious', 'frantic', 'panic', 'asleep']
  const STOPS = [[0, 6], [.05, 8], [.2, 49], [.24, 50], [.39, 79], [.43, 80], [.56, 94], [.6, 95], [.72, 99], [.76, 100], [1, 100]]
  const pctAt = p => {
    for (let i = 1; i < STOPS.length; i++) {
      const [a, va] = STOPS[i - 1], [b, vb] = STOPS[i]
      if (p <= b) return Math.round(lerp(va, vb, inv(a, b, p)))
    }
    return 100
  }
  const N = 40
  let shownPct = -1, shownMood = '', smooth = 0, celebrated = false, outfitKey = ''
  const toneHex = pct => H.TONES[H.tone(pct)]
  function drawCrab(mood) {
    const o = { ...outfitNow() }
    delete o.scene
    outfitKey = JSON.stringify(o)
    crabEl.innerHTML = `<svg viewBox="-4 -6 56 32" shape-rendering="crispEdges">${H.clawdSvg(mood, 'idle', o, false, true)}</svg>`
    if (REDUCED) try { crabEl.firstElementChild.pauseAnimations() } catch {}
  }
  function drawPct(pct) {
    const color = pct >= 100 ? '#9aa6c4' : toneHex(pct)
    pctEl.innerHTML = pixSvg(`${pct}%`, color)
    pctEl.setAttribute('aria-label', `Weekly limit ${pct}%`)
    const lit = pct <= 0 ? 0 : Math.max(1, Math.round(pct / 100 * N))
    let on = '', off = ''
    for (let j = 0; j < N; j++) (j < lit ? (on += `M${j * 5} 0h4v8h-4z`) : (off += `M${j * 5} 0h4v8h-4z`))
    barEl.innerHTML = `<svg viewBox="0 0 ${N * 5 - 1} 8" preserveAspectRatio="none" shape-rendering="crispEdges"><path d="${off}" fill="#8b9099" opacity=".22"/><path d="${on}" fill="${toneHex(pct)}"/>${lit ? `<path d="M${(lit - 1) * 5} 0h4v8h-4z" fill="#fff" opacity=".3"/>` : ''}</svg>`
    const note = H.noteOf({ pct, name: 'weekly limit', resetIn: '2d 4h' })
    if (note) {
      const n = H.noteSvg(note, 6, toneHex(pct))
      noteEl.innerHTML = `<svg viewBox="0 4 ${n.width + 8} 16" shape-rendering="crispEdges">${n.svg}</svg>`
    } else noteEl.innerHTML = ''
    const glow = pct >= 100 ? '#56679a' : toneHex(pct)
    sec.style.setProperty('--glow', glow)
    sec.style.setProperty('--tone', toneHex(pct))
  }
  function setMood(mood) {
    const [name, range, desc] = MOODS[mood]
    nameEl.textContent = name
    rangeEl.textContent = range
    descEl.textContent = desc
    sec.classList.toggle('night', mood === 'asleep')
    const k = ORDER.indexOf(mood)
    steps.forEach((li, i) => li.classList.toggle('on', i <= k))
    drawCrab(mood)
    if (shownMood) {
      crabEl.classList.remove('hit'); void crabEl.offsetWidth; crabEl.classList.add('hit')
      Sound.blip()
    }
    shownMood = mood
  }
  on('progress', () => { const o = { ...outfitNow() }; delete o.scene; if (JSON.stringify(o) !== outfitKey && shownMood) drawCrab(shownMood) })
  // 100% pays: a burst of pixel coins out of the crab
  const cv = $('#moodsBurst'), cx = cv.getContext('2d')
  let coins = []
  function burst() {
    const r = crabEl.getBoundingClientRect(), s = cv.getBoundingClientRect()
    const ox = r.left - s.left + r.width * .42, oy = r.top - s.top + r.height * .45
    for (let i = 0; i < 46; i++) {
      const a = rand(-Math.PI * .95, -Math.PI * .05)
      const v = rand(380, 900)
      coins.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rand(1.2, 2), spin: rand(6, 14), size: rand(2.4, 4) })
    }
    Sound.coin(); setTimeout(() => Sound.level(), 180)
  }
  function drawCoins(dt) {
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cx.clearRect(0, 0, w, h)
    coins = coins.filter(c => (c.t += dt) < c.life)
    for (const c of coins) {
      c.vy += 1500 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= .995
      const frame = H.COIN_TURN[Math.floor(c.t * c.spin) % H.COIN_TURN.length]
      cx.globalAlpha = clamp((c.life - c.t) * 3)
      cx.fillStyle = H.COLORS.coin
      frame.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') cx.fillRect(Math.round(c.x + (x - 2.5) * c.size), Math.round(c.y + (y - 2.5) * c.size), Math.ceil(c.size), Math.ceil(c.size)) })
    }
    cx.globalAlpha = 1
  }
  drawPct(6); setMood('happy')
  tickers.add(dt => {
    if (!isNear(sec)) return
    const r = sec.getBoundingClientRect()
    const p = clamp(-r.top / (r.height - vh))
    smooth = REDUCED ? p : lerp(smooth, p, 1 - Math.exp(-dt * 14))
    const pct = pctAt(smooth)
    if (pct !== shownPct) {
      shownPct = pct
      drawPct(pct)
      const mood = H.moodOf(pct)
      if (mood !== shownMood) setMood(mood)
      if (pct >= 100 && !celebrated) { celebrated = true; if (!REDUCED) burst() }
      if (pct < 98) celebrated = false
    }
    if (coins.length || cv.width) drawCoins(dt)
  })
}

// ------------------------------------------------------------------ 03 levels: a side-scroller up the level road
{
  const sec = watch($('#levels'))
  const world = $('#roadWorld'), crabEl = $('#roadCrab'), road = $('#road')
  const MILES = [
    { at: 1, title: 'Hatchling', what: 'Where every crab starts', item: null },
    ...H.LEVELS.filter(l => l.item).map(l => ({ at: l.at, title: l.title, what: `${H.ITEMS[l.item].name[0].toUpperCase()}${H.ITEMS[l.item].name.slice(1)}`, item: l.item })),
  ]
  let SP = 360, TW = 3600, built = false, crabX = 0
  const base = H.newProgress()
  function build() {
    const W = road.clientWidth, Hh = road.clientHeight
    SP = clamp(W * .3, 230, 420)
    TW = SP * (MILES.length + .2) + W * .5
    const ground = Math.min(64, Math.max(40, Hh * .14))
    crabX = W * .3
    // far hills and near pines, tiled pixel layers
    const hill = (w, h, seed, cell) => {
      let d = '', y = h * .5, s = seed
      for (let x = 0; x < w; x += cell) {
        s = (s * 9301 + 49297) % 233280
        y = clamp(y + (s / 233280 - .5) * cell * 1.6, h * .15, h * .8)
        d += `M${x} ${Math.round(y / cell) * cell}h${cell}v${h}h-${cell}z`
      }
      return d
    }
    const farH = Hh * .6, nearH = Hh * .32
    // a night sky: slow stars and a crescent moon, far behind everything
    let stars = '', twinkle = '', seed = 11
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    const skyW = TW * .12 + W
    for (let k = 0; k < Math.round(skyW / 22); k++) {
      const x = Math.round(rnd() * skyW), y = Math.round(rnd() * Hh * .5), z = rnd() < .2 ? 3 : 2
      const d = `M${x} ${y}h${z}v${z}h-${z}z`
      rnd() < .25 ? (twinkle += d) : (stars += d)
    }
    const moon = H.pixels(['..###.', '.##...', '##....', '##....', '##....', '.##...', '..###.'], W * .74, Hh * .1, 7, '#')
    let pines = ''
    for (let x = 40, i = 0; x < TW * .75; x += 110 + ((i * 37) % 90), i++) pines += H.pixels(H.PINE, x, nearH - 8 * 9 - ((i * 13) % 3) * 9, 9, '#')
    world.innerHTML = `
      <div class="road-layer" data-depth=".03" style="width:${W}px"><svg viewBox="0 0 ${W} ${Hh}" shape-rendering="crispEdges" style="width:${W}px;height:${Hh}px;position:absolute;top:0"><path d="${moon}" fill="#c9cbd6" opacity=".55"/></svg></div>
      <div class="road-layer" data-depth=".12" style="width:${skyW}px"><svg viewBox="0 0 ${skyW} ${Hh}" shape-rendering="crispEdges" style="width:${skyW}px;height:${Hh}px;position:absolute;top:0"><path d="${stars}" fill="#3a4152"/><path class="twinkle" d="${twinkle}" fill="#6c7387"/></svg></div>
      <div class="road-layer" data-depth=".25" style="width:${TW * .5 + W}px;height:${farH + ground}px"><svg viewBox="0 0 ${TW * .5 + W} ${farH}" preserveAspectRatio="none" shape-rendering="crispEdges" style="height:${farH}px;width:${TW * .5 + W}px;position:absolute;bottom:${ground}px"><path d="${hill(TW * .5 + W, farH, 7, 16)}" fill="#171b23"/></svg></div>
      <div class="road-layer" data-depth=".55" style="width:${TW * .75 + W}px"><svg viewBox="0 0 ${TW * .75 + W} ${nearH}" shape-rendering="crispEdges" style="height:${nearH}px;width:${TW * .75 + W}px;position:absolute;bottom:${ground}px"><path d="${pines}" fill="#1c222b"/></svg></div>
      <div class="road-layer" data-depth="1" style="width:${TW + W}px">
        <svg viewBox="0 0 ${TW + W} ${ground}" shape-rendering="crispEdges" style="height:${ground}px;width:${TW + W}px;position:absolute;bottom:0"><rect width="${TW + W}" height="${ground}" fill="#20252e"/><rect width="${TW + W}" height="4" fill="#353b47"/><path d="${Array.from({ length: Math.ceil((TW + W) / 24) }, (_, i) => `M${i * 24 + ((i * 7) % 12)} ${8 + ((i * 5) % 3) * 6}h4v4h-4z`).join('')}" fill="#2a303a"/></svg>
        ${MILES.map((m, i) => `<div class="milestone" data-i="${i}" style="left:${crabX + SP * (i + .6)}px;bottom:${ground}px">
          <div class="card"><div class="lvl">${pixSvg(`LV${m.at}`, H.COLORS.level)}</div><h4>${esc(m.title)}</h4><p>${esc(m.what)}</p>
          <div class="thumb">${m.item ? H.wardrobeSvg({ [H.ITEMS[m.item].slot]: m.item }, 2).replace(/width="\d+" height="\d+"/, '') : H.wardrobeSvg({}, 2).replace(/width="\d+" height="\d+"/, '')}</div></div>
          <div class="post" style="height:${Math.max(18, Hh * .1)}px"></div></div>`).join('')}
      </div>`
    crabEl.style.bottom = `${ground - 4}px`
    crabEl.style.left = `${crabX}px`
    built = true
    lastLevel = -1
  }
  let lastLevel = -1, hopT = 0, frameI = 0, smooth = 0, burstUntil = 0
  const HOP = [0, -5, -9, -5]
  function drawCrab(level, burst) {
    const o = H.outfitOf(base, level)
    crabEl.innerHTML = `<svg viewBox="2 0 40 24" shape-rendering="crispEdges">${H.clawdSvg('happy', 'idle', o, burst, false)}</svg>`
  }
  const lvEl = $('#roadLv'), titleEl = $('#roadTitle'), xpEl = $('#roadXp i'), bigEl = $('#roadBig')
  addEventListener('resize', () => { built = false })
  tickers.add((dt, t) => {
    if (!isNear(sec)) return
    if (!built) build()
    const r = sec.getBoundingClientRect()
    const p = clamp(-r.top / (r.height - vh))
    smooth = REDUCED ? p : lerp(smooth, p, 1 - Math.exp(-dt * 10))
    const W = road.clientWidth
    const off = smooth * (TW - W * .62)
    for (const layer of $$('.road-layer', world)) layer.style.transform = `translate3d(${r2(-off * +layer.dataset.depth)}px,0,0)`
    // the level: between milestones the number climbs
    const pos = (off) / SP - .6
    const i = clamp(Math.floor(pos), -1, MILES.length - 1)
    let level = 1
    if (i >= 0) {
      const a = MILES[i].at, b = MILES[i + 1]?.at ?? a
      level = Math.floor(lerp(a, b, clamp(pos - i)))
    }
    level = clamp(level, 1, 50)
    const reached = MILES.filter((m, k) => k <= i).pop()
    $$('.milestone', world).forEach(el => el.classList.toggle('got', +el.dataset.i <= i))
    if (level !== lastLevel) {
      const gotItem = reached && lastLevel !== -1 && level === reached.at && lastLevel < level
      if (gotItem && reached.item) { burstUntil = t + 1.4; Sound.level() }
      lastLevel = level
      lvEl.innerHTML = pixSvg(`LV${level}`, H.COLORS.level)
      bigEl.innerHTML = pixSvg(String(level), 'currentColor')
      if (!REDUCED) bigEl.animate([{ transform: 'translateY(14%)' }, { transform: 'none' }], { duration: 380, easing: 'steps(4, end)' })
      titleEl.innerHTML = `<small>Title</small>${esc(H.titleOf(level))}`
      xpEl.parentElement.setAttribute('aria-label', `Level ${level}`)
      drawCrab(level, gotItem)
    }
    const xpFrac = i >= 0 && MILES[i + 1] ? clamp(pos - i) : 1
    xpEl.style.setProperty('--xp', `${Math.round(xpFrac * 100)}%`)
    // He hops while you scroll, and turns round when you scroll back.
    const moving = Math.abs(vel) > 25 && smooth > .001 && smooth < .999
    hopT += dt
    if (moving && hopT > .085) { hopT = 0; frameI = (frameI + 1) % HOP.length }
    if (!moving && hopT > .085) frameI = 0
    crabEl.classList.toggle('back', vel < -25)
    const s = crabEl.clientWidth / 40
    crabEl.style.transform = `translate3d(-50%, ${HOP[frameI] * s / 2}px, 0)`
  })
}

// ------------------------------------------------------------------ XP sheet, level curve, badges
{
  const rows = [
    ['+10', H.COLORS.level, '<b>per turn</b>, or 2 after your first 60 of the day'],
    ['+25', H.COLORS.level, '<b>for the first turn</b> of each day'],
    ['+5', H.COLORS.level, '<b>for each point</b> your weekly limit rises'],
    ['+100', H.TONES.ok, '<b>for a 5-hour window</b> that peaks at 60–99%, or 40 at 30–59%'],
    ['+150', H.TONES.hot, '<b>the moment the weekly limit hits 100%</b>; a 5-hour window pays 60'],
    ['+50', H.COLORS.golden, '<b>per badge</b>, plus 25 coins'],
  ]
  $('#xpList').innerHTML = rows.map(([n, c, t]) => `<li><span class="amt">${pixSvg(n, c)}</span><p>${t}</p></li>`).join('')
  // the curve: total XP for each level, to scale
  const W = 500, Hc = 170, padL = 44, padB = 22, top = 28
  const max = H.xpFor(50)
  const bw = (W - padL) / 50
  let bars = '', marks = ''
  for (let L = 1; L <= 50; L++) {
    const v = H.xpFor(L), h = Math.max(1, (v / max) * (Hc - padB - top))
    const ms = H.LEVELS.find(m => m.at === L && m.item)
    bars += `<rect x="${r2(padL + (L - 1) * bw + .6)}" y="${r2(Hc - padB - h)}" width="${r2(bw - 1.2)}" height="${r2(h)}" fill="${ms ? '#a99be0' : '#4a4560'}"><title>Level ${L}: ${fmt(v)} XP</title></rect>`
    if (ms) marks += `<text x="${r2(padL + (L - .5) * bw)}" y="${Hc - 6}" text-anchor="middle" fill="#8b9099" font-size="10" font-family="Martian Mono, monospace" font-stretch="87.5%">${L}</text>`
  }
  const ticks = [0, 60000, 120000].map(v => `<line x1="${padL}" x2="${W}" y1="${r2(Hc - padB - (v / max) * (Hc - padB - top))}" y2="${r2(Hc - padB - (v / max) * (Hc - padB - top))}" stroke="#262931"/><text x="${padL - 6}" y="${r2(Hc - padB - (v / max) * (Hc - padB - top) + 3)}" text-anchor="end" fill="#8b9099" font-size="10" font-family="Martian Mono, monospace" font-stretch="87.5%">${v ? `${v / 1000}k` : '0'}</text>`).join('')
  $('#curve').innerHTML = `<svg viewBox="0 0 ${W} ${Hc}" style="overflow:visible" role="img" aria-label="Total XP by level, from 0 at level 1 to 122,500 at level 50">${ticks}${bars}${marks}<text x="${W}" y="${top - 12}" text-anchor="end" fill="#efebe4" font-size="11" font-family="Martian Mono, monospace" font-stretch="87.5%">122,500 XP at level 50</text></svg>`
  $('#streakFlame').innerHTML = `<svg viewBox="0 0 13 5" shape-rendering="crispEdges" style="height:30px"><path d="${gridD(H.FLAME_A, 'r', 1, 0, .5)}" fill="${H.COLORS.flameOut}"/><path d="${gridD(H.FLAME_A, 'y', 1, 0, .5)}" fill="${H.COLORS.flameIn}"/><path d="${pixD('12', 1, 5.5, 0).d}" fill="#8b9099"/></svg>`
}
const MEDAL = ['.....#####.....', '...##.....##...', '..#.........#..', '.#...........#.', '.#...........#.', '#.............#', '#.............#', '#.............#', '#.............#', '#.............#', '.#...........#.', '.#...........#.', '..#.........#..', '...##.....##...', '.....#####.....']
const MEDAL_IN = MEDAL.map(r => { const a = r.indexOf('#'), b = r.lastIndexOf('#'); return r.split('').map((c, i) => (i > a && i < b ? 'f' : '.')).join('') })
MEDAL_IN[0] = MEDAL_IN[14] = '.'.repeat(15)
const BADGE_ART = {
  'first-steps': [['.#####.', '##k#k##', '.#####.', '..#.#..'], { '#': H.CLAWD, k: '#1b1b1b' }],
  'on-a-roll': [['..r.###', '.rr...#', 'ryyr.#.', '.yy..#.', '.....#.'], { r: H.COLORS.flameOut, y: H.COLORS.flameIn, '#': '#efebe4' }],
  unstoppable: [['....r....', '...rr....', '..ryyr...', '...yy....', '.........', '.###.###.', '...#.#.#.', '..##.#.#.', '...#.#.#.', '.###.###.'], { r: H.COLORS.flameOut, y: H.COLORS.flameIn, '#': '#efebe4' }],
  'close-call': [['###.###.#.#', '#.#.#...#..', '###.###..#.', '..#...#.#..', '###.###.#.#'], { '#': H.TONES.warn }],
  zen: [['...#...', '..#.#..', '.#.#.#.', '#.#.#.#', '.#####.'], { '#': H.TONES.ok }],
  'perfect-pace': [['..c..c..c', 'gggggg...', '.........', 'gggggggg.', '.........', 'ggggggg..'], { g: H.TONES.ok, c: '#8b9099' }],
  'maxed-out': [['.#..###..###', '##..#.#..#.#', '.#..#.#..#.#', '.#..#.#..#.#', '###.###..###'], { '#': H.TONES.hot }],
  phoenix: [['#.......#', '##.....##', '.##.#.##.', '..#####..', '...###...', '....#....', '...#.#...'], { '#': H.COLORS.coin }],
  marathon: [['.##......', '#..#.....', '#..##....', '.#####...', '....###..', '.....###.', '......##.'], { '#': '#9aa6c4' }],
  'deep-thinker': [['.#######.', '#.......#', '#.w.w.w.#', '#.......#', '.#######.', '..#......', '.#.......'], { '#': H.COLORS.level, w: '#efebe4' }],
  'fresh-start': [['....#....', '....#....', '..#.#.#..', '...###...', '#########', '...###...', '..#.#.#..', '....#....', '....#....'], { '#': H.COLORS.shine }],
  'night-owl': [['..###....', '.##......', '##.....#.', '##....###', '##.....#.', '.##......', '..###....'], { '#': H.COLORS.zed }],
  'early-bird': [['....#....', '.#.....#.', '...###...', '#.#####.#', '.#######.', 'hhhhhhhhh'], { '#': H.COLORS.coin, h: '#8b9099' }],
}
function badgeSvg(id, earned) {
  const [g, colors] = BADGE_ART[id]
  const w = Math.max(...g.map(r => r.length)), h = g.length
  const ox = Math.floor((15 - w) / 2), oy = Math.floor((15 - h) / 2)
  const ring = earned ? H.COLORS.golden : '#3b3f49'
  let art = ''
  for (const [ch, fill] of Object.entries(colors)) art += `<path d="${gridD(g, ch, 1, ox, oy)}" fill="${fill}"/>`
  return `<svg viewBox="0 0 15 15" shape-rendering="crispEdges" aria-hidden="true"><path d="${gridD(MEDAL_IN, 'f')}" fill="${earned ? '#2a2620' : '#1b1d22'}"/><path d="${gridD(MEDAL)}" fill="${ring}"/>${art}</svg>`
}
function drawBadges(fresh) {
  $('#badges').innerHTML = Object.entries(H.BADGES).map(([id, b]) => {
    const got = !!st.p.badges[id]
    return `<div class="badge${fresh && fresh.includes(id) ? ' new' : ''}" data-id="${id}"><div class="icon">${badgeSvg(id, got)}</div><h4>${esc(b.name)}</h4><p>${esc(clean(b.how)).replace(/^./, c => c.toUpperCase())}.</p>${got ? '<span class="got">Earned</span>' : ''}</div>`
  }).join('')
}
let badgeKeys = Object.keys(st.p.badges)
drawBadges()
on('badges', () => {
  const now = Object.keys(st.p.badges)
  const fresh = now.filter(k => !badgeKeys.includes(k))
  badgeKeys = now
  drawBadges(fresh)
})
// Badges lean toward the pointer.
if (FINE && !REDUCED) {
  $('#badges').addEventListener('pointermove', e => {
    const card = e.target.closest('.badge')
    $$('.badge').forEach(b => { if (b !== card) b.style.transform = '' })
    if (!card) return
    const r = card.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5
    card.style.transform = `perspective(600px) rotateX(${r2(-y * 10)}deg) rotateY(${r2(x * 12)}deg) translateY(-3px)`
  })
  $('#badges').addEventListener('pointerleave', () => $$('.badge').forEach(b => { b.style.transform = '' }))
}

// ------------------------------------------------------------------ 04 shop
const shop = { slot: 'head', preview: null }
{
  const tabs = $('#tabs'), itemsEl = $('#items'), wallet = $('#wallet')
  $('#walletCoin').innerHTML = COIN_SVG
  const count = slot => Object.values(H.ITEMS).filter(i => i.slot === slot).length
  tabs.innerHTML = H.SLOTS.map(s => `<button class="tab" type="button" role="tab" data-slot="${s}" aria-selected="${s === shop.slot}">${H.SLOT_NAMES[s]}<span class="n">${count(s)}</span></button>`).join('')
  $$('.tab', tabs).forEach(t => t.addEventListener('click', () => {
    shop.slot = t.dataset.slot
    $$('.tab', tabs).forEach(x => x.setAttribute('aria-selected', String(x === t)))
    drawItems(true)
  }))
  const STATE = { wearing: 'Wearing', owned: 'Owned', buy: 'Buy', short: 'Need more', locked: 'Locked' }
  function drawItems(anim) {
    const shelf = H.shelfOf(st.p).filter(s => s.slot === shop.slot)
    const level = H.levelOf(st.p.xp)
    itemsEl.innerHTML = shelf.map((s, i) => {
      const it = H.ITEMS[s.id]
      const price = it.price
        ? `<span class="price">${COIN_SVG}${fmt(it.price)}</span>${it.level ? `<span class="lock">Lv${it.level}</span>` : ''}`
        : `<span class="lock">Level ${H.LEVELS.find(m => m.item === s.id)?.at}</span>`
      const pic = H.wardrobeSvg({ [s.slot]: s.id }, 3).replace(/width="\d+" height="\d+"/, 'preserveAspectRatio="xMidYMid meet"')
      return `<button class="item" type="button" data-id="${s.id}" data-state="${s.state}" style="${anim ? `animation-delay:${i * 35}ms` : 'animation:none'}" aria-label="${esc(it.name)}, ${STATE[s.state]}">
        <span class="pic">${pic}</span><span class="nm${s.slot === 'scene' ? ' keep' : ''}">${esc(it.name)}</span>
        <span class="meta"><span style="display:flex;gap:8px;align-items:center">${price}</span><span class="state">${STATE[s.state]}</span></span></button>`
    }).join('')
    $('#walletCoins').textContent = fmt(shownCoins)
    $('#walletLvl').textContent = `Lv ${level}`
    $$('.item', itemsEl).forEach(el => {
      el.addEventListener('mouseenter', () => preview(el.dataset.id))
      el.addEventListener('focus', () => preview(el.dataset.id))
      el.addEventListener('mouseleave', () => preview(null))
      el.addEventListener('blur', () => preview(null))
      el.addEventListener('click', () => press(el))
    })
  }
  function preview(id) {
    shop.preview = id ? { [H.ITEMS[id].slot]: id } : null
    fire('fit')
  }
  function press(el) {
    const id = el.dataset.id
    const s = H.shelfOf(st.p).find(x => x.id === id)
    const change = H.pressOf(s)
    if (!change) {
      el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope')
      const it = H.ITEMS[id]
      toast(s.state === 'short' ? `The ${it.name} costs ${fmt(it.price)} coins and you have ${fmt(st.p.coins)}. Send a few prompts above to earn more.` : `The ${it.name} needs level ${s.level}. You're level ${H.levelOf(st.p.xp)}.`, 'coin')
      Sound.thud()
      return
    }
    if (s.state === 'buy') flyCoins(el)
    else Sound.blip()
    shop.preview = null
    apply(change(st.p, id), { say: true })
    drawItems(false)
    fire('fit')
  }
  let shownCoins = st.p.coins
  function flyCoins(card) {
    const a = $('#walletCoin').getBoundingClientRect(), b = card.getBoundingClientRect()
    Sound.coin()
    wallet.classList.remove('pulse'); void wallet.offsetWidth; wallet.classList.add('pulse')
    if (REDUCED) return
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('div')
      c.className = 'flycoin'
      c.innerHTML = COIN_SVG
      document.body.appendChild(c)
      const x0 = a.left + a.width / 2 - 7, y0 = a.top + a.height / 2 - 7
      const x1 = b.left + b.width / 2 - 7 + rand(-20, 20), y1 = b.top + b.height * .35 + rand(-10, 10)
      const lift = rand(60, 140)
      c.animate([
        { transform: `translate(${x0}px, ${y0}px) scale(.6)` },
        { transform: `translate(${lerp(x0, x1, .5)}px, ${Math.min(y0, y1) - lift}px) scale(1.15)`, offset: .5 },
        { transform: `translate(${x1}px, ${y1}px) scale(.5)`, opacity: .2 },
      ], { duration: 620 + i * 40, delay: i * 45, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).onfinish = () => c.remove()
    }
  }
  // the balance counts to its new value
  tickers.add(dt => {
    const target = st.p.coins
    if (Math.round(shownCoins) === target) return
    shownCoins = Math.abs(target - shownCoins) < 1 ? target : lerp(shownCoins, target, 1 - Math.exp(-dt * 8))
    $('#walletCoins').textContent = fmt(shownCoins)
  })
  on('progress', () => { if (!itemsEl.matches(':hover')) drawItems(false); $('#walletLvl').textContent = `Lv ${H.levelOf(st.p.xp)}` })
  drawItems(true)
}
const fitOutfit = () => ({ ...outfitNow(), ...(shop.preview || {}) })
function fitLabel() {
  const o = fitOutfit()
  const worn = H.SLOTS.filter(s => o[s]).map(s => H.ITEMS[o[s]]?.name).filter(Boolean)
  const nm = $('#fitName')
  nm.innerHTML = `<small>${shop.preview ? 'Trying on' : 'Wearing'}</small>${worn.length ? esc(worn.join(', ')).replace(/^./, c => c.toUpperCase()) : 'Nothing yet'}`
  const scene = o.scene && H.SCENES[o.scene]
  const sky = $('#fittingSky')
  const gl = $('#fitting').classList.contains('gl-on')
  sky.style.background = !scene ? '' : gl ? `radial-gradient(120% 90% at 50% 18%, ${mixHex(scene.sky, '#ffffff', .14)}, ${scene.sky} 62%, ${mixHex(scene.sky, '#000000', .25)})` : `linear-gradient(${scene.sky} 0 72%, ${scene.ground} 72%)`
  sky.style.opacity = scene ? '1' : '0'
  if (!gl) {
    $('#fittingFallback').innerHTML = H.wardrobeSvg(o, 6).replace(/width="\d+" height="\d+"/, '')
  }
}
on('fit', fitLabel)
on('progress', fitLabel)
fitLabel()

// ------------------------------------------------------------------ 05 backdrops: six scenes, an ordered-dither wipe between them
{
  const sec = watch($('#backdrops'))
  const stage = $('#bdStage'), svg = $('#bdSvg')
  const IDS = ['forest', 'beach', 'city', 'australia', 'malaysia', 'space']
  const INFO = {
    forest: ['Forest', 'Pines on low hills, and fireflies over the trees.'],
    beach: ['Beach', 'A palm, an umbrella and the sun over the waves.'],
    city: ['City at night', 'Lit windows under a crescent moon.'],
    australia: ['Australia', 'The Sydney Opera House on the harbour, under a rising moon.'],
    malaysia: ['Malaysia', 'Twin towers, a palm, and a crescent moon with its star.'],
    space: ['Space', 'A ringed planet and slow stars. Needs level 10.'],
  }
  $('#bdIndex').innerHTML = IDS.map(id => `<li data-id="${id}">${esc(INFO[id][0])}</li>`).join('')
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
  let u = 10, Wu = 100, Hu = 60, box = 60, bx = 0, by = 0, cell = 3, cols = 0, rows = 0, built = false
  let cur = -1, mix = -1, next = -1, mxs = 0, mys = 0, mx = 0, my = 0
  // A scene as separate layers, so each can drift at its own depth.
  function sceneLayers(id, outfit) {
    const s = H.SCENES[id]
    const P = H.SCENE_P, G = H.GROUND_Y
    const parts = []
    parts.push({ depth: 0, svg: `<rect x="-40" y="-40" width="${Wu + 80}" height="${Hu + 80}" fill="${s.sky}"/>` })
    s.layers.forEach((l, i) => {
      const p = l.p ?? P
      const colsL = Math.max(...l.grid.map(r => r.length))
      const ly = by + G - (l.up ?? 0) * P - l.grid.length * p
      const paint = (ox, oy) => Object.entries(l.colors).map(([ch, fill]) => `<path d="${H.pixels(l.grid, ox, oy, p, ch)}" fill="${fill}"/>`).join('')
      if (l.repeat) {
        const tile = `bdt-${id}-${i}`
        parts.push({ depth: .25, svg: `<defs><pattern id="${tile}" x="0" y="${ly}" width="${colsL * p}" height="${l.grid.length * p}" patternUnits="userSpaceOnUse">${paint(0, 0)}</pattern></defs><rect x="-40" y="${ly}" width="${Wu + 80}" height="${l.grid.length * p}" fill="url(#${tile})"/>` })
      } else {
        const x = l.right === undefined ? bx + (l.left ?? 0) * P : bx + box - l.right * P - colsL * p
        parts.push({ depth: (l.up ?? 0) > 4 ? .35 : .6, svg: paint(x, ly) })
      }
    })
    parts.push({ depth: .8, svg: `<rect x="-40" y="${by + G}" width="${Wu + 80}" height="${Hu}" fill="${s.ground}"/>`, ground: true })
    const o = { ...outfit }
    delete o.scene
    parts.push({ depth: 1, svg: `<g transform="translate(${r2(bx + box / 2 - 21)} ${by})">${H.clawdSvg('happy', 'idle', o, false, true)}</g>` })
    // ground before the crab, after the landmarks
    const g = parts.findIndex(x => x.ground)
    const [gp] = parts.splice(g, 1)
    parts.splice(parts.length - 1, 0, gp)
    return parts
  }
  function build() {
    const w = stage.clientWidth, h = stage.clientHeight
    u = Math.min(h / 80, w / 56)
    Wu = w / u; Hu = h / u
    box = Math.min(Wu - 2, 64)
    bx = (Wu - box) / 2
    by = Hu * .5 - 12
    cell = Wu * Hu > 14000 ? 3 : 2
    cols = Math.ceil(Wu / cell) + 1; rows = Math.ceil(Hu / cell) + 1
    svg.setAttribute('viewBox', `0 0 ${r2(Wu)} ${r2(Hu)}`)
    built = true
    cur = -1
  }
  function layerGroups(id, cls, masked) {
    const parts = sceneLayers(id, outfitNow())
    return `<g class="${cls}"${masked ? ' mask="url(#bdMask)"' : ''}>${parts.map(p => `<g data-depth="${p.depth}">${p.svg}</g>`).join('')}</g>`
  }
  function render(a, b) {
    svg.innerHTML = `<defs><mask id="bdMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${r2(Wu)}" height="${r2(Hu)}"><path id="bdCells" d="" fill="#fff"/></mask></defs>${layerGroups(IDS[a], 'cur', false)}${b >= 0 ? layerGroups(IDS[b], 'nxt', true) : ''}`
    if (REDUCED) try { svg.pauseAnimations() } catch {}
  }
  function cells(t) {
    let d = ''
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const th = ((BAYER[j % 4][i % 4] + .5) / 16) * .55 + (i / cols) * .45
      if (th < t) d += `M${i * cell} ${j * cell}h${cell}v${cell}h-${cell}z`
    }
    return d
  }
  let capFor = -1
  function caption(k) {
    if (capFor === k) return
    capFor = k
    const id = IDS[k], it = H.ITEMS[id]
    $('#bdName').textContent = INFO[id][0]
    $('#bdDesc').textContent = INFO[id][1]
    $('#bdPrice').innerHTML = `${COIN_SVG}${fmt(it.price)} coins${it.level ? ` · level ${it.level}` : ''}`
    $$('#bdIndex li').forEach((li, i) => li.classList.toggle('on', i === k))
    stage.style.background = H.SCENES[id].sky
    const cap = $('#bdCap')
    if (!REDUCED) cap.animate([{ transform: 'translateY(10px)' }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.16,1,.3,1)' })
  }
  addEventListener('resize', () => { built = false })
  on('progress', () => { cur = -1 })
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - .5; my = (e.clientY - r.top) / r.height - .5 })
  stage.addEventListener('pointerleave', () => { mx = 0; my = 0 })
  let smooth = 0
  tickers.add(dt => {
    if (!isNear(sec)) return
    if (!built) build()
    const r = sec.getBoundingClientRect()
    const p = clamp(-r.top / (r.height - vh))
    smooth = REDUCED ? p : lerp(smooth, p, 1 - Math.exp(-dt * 12))
    const t = smooth * IDS.length
    const k = Math.min(IDS.length - 1, Math.floor(t))
    const f = t - k
    const m = k < IDS.length - 1 ? inv(.62, .98, f) : 0
    const nk = m > 0 ? k + 1 : -1
    if (k !== cur || nk !== next) { cur = k; next = nk; render(k, nk); mix = -1 }
    const mq = Math.round(m * 48) / 48
    if (mq !== mix && nk >= 0) { mix = mq; const c = $('#bdCells', svg); if (c) c.setAttribute('d', cells(mq)) }
    caption(m > .5 ? nk : k)
    // depth parallax from the pointer
    mxs = lerp(mxs, mx, 1 - Math.exp(-dt * 5)); mys = lerp(mys, my, 1 - Math.exp(-dt * 5))
    if (!REDUCED) for (const g of svg.querySelectorAll('[data-depth]')) {
      const d = +g.dataset.depth
      g.setAttribute('transform', `translate(${r2(-mxs * d * 3)} ${r2(-mys * d * 1.4)})`)
    }
  })
}

// ------------------------------------------------------------------ 06 under the hood
{
  // Every session agrees: three sessions, one store
  const el = $('#syncDemo')
  const S = [{ id: 'A', dir: '~/api', ctx: 12, s5: 41 }, { id: 'B', dir: '~/web', ctx: 38, s5: 41 }, { id: 'C', dir: '~/notes', ctx: 64, s5: 41 }]
  const VW = 440, rowH = 50
  const bandFor = (s, k) => {
    const snap = { ctxPct: s.ctx, ctxWindow: 1_000_000, limits: [{ kind: 'five_hour', pct: s.s5, resetsAt: iso(st.reset5) }, { kind: 'seven_day', pct: 18, resetsAt: iso(st.reset7) }] }
    return H.pixelSvg(H.tanksOf(snap, s.from ? { ...snap, limits: [{ kind: 'five_hour', pct: s.from }, { kind: 'seven_day', pct: 18 }] } : snap, Date.now()), undefined, 'idle', 222).replace('<svg ', `<svg x="78" y="${10 + k * rowH + 13}" `)
  }
  let packets = [], storePulse = 0, busyS = false
  function draw() {
    const rows = S.map((s, k) => `<g><rect x="0.5" y="${10 + k * rowH + .5}" width="306" height="${rowH - 10}" rx="7" fill="#15171c" stroke="#2c2f37"/>
      <text x="12" y="${10 + k * rowH + 19}" fill="#efebe4" font-size="11" font-family="Schibsted Grotesk, sans-serif" font-weight="600">Session ${s.id}</text>
      <text x="12" y="${10 + k * rowH + 32}" fill="#8b9099" font-size="9.5" font-family="Martian Mono, monospace" font-stretch="87.5%">${s.dir}</text>
      ${bandFor(s, k)}</g>`).join('')
    const sx = 370, sy0 = 10 + rowH * 1.5 - 22
    const lines = S.map((_, k) => `<path d="M307 ${10 + k * rowH + 20}H330Q340 ${10 + k * rowH + 20} 340 ${sy0 + 22 + (k - 1) * 10}H${sx - 26}" fill="none" stroke="#2c2f37" stroke-width="1.5"/>`).join('')
    const pk = packets.map(p => `<rect x="${r2(p.x - 3)}" y="${r2(p.y - 3)}" width="6" height="6" fill="${H.TONES[H.tone(p.pct)]}"/>`).join('')
    el.innerHTML = `<svg viewBox="0 0 ${VW} ${10 + rowH * 3}" role="img" aria-label="Three sessions sharing one store">${lines}${rows}
      <g transform="translate(${sx - 26} ${sy0})"><rect x="0" y="0" width="${70 + storePulse * 4}" height="44" rx="6" fill="${storePulse > 0 ? '#23262d' : '#1a1c21'}" stroke="${storePulse > 0 ? '#c4a05a' : '#2c2f37'}"/>
      <text x="10" y="18" fill="#efebe4" font-size="10.5" font-family="Martian Mono, monospace" font-stretch="87.5%">store</text><text x="10" y="32" fill="#8b9099" font-size="9" font-family="Martian Mono, monospace" font-stretch="87.5%">readings</text></g>${pk}</svg>
      <div class="sync-row"><span class="say" id="syncSay">5h and 7d match everywhere. ctx stays per session.</span><button class="btn btn-ghost" type="button" id="syncBtn">Reply in session B</button></div>`
    $('#syncBtn').addEventListener('click', go)
  }
  const pathPt = (k, t, toStore) => {
    const y0 = 10 + k * rowH + 20, sy0 = 10 + rowH * 1.5 - 22, y1 = sy0 + 22 + (k - 1) * 10
    const tt = toStore ? t : 1 - t
    const x = lerp(307, 344, tt), y = tt < .4 ? y0 : tt > .7 ? y1 : lerp(y0, y1, (tt - .4) / .3)
    return [x, y]
  }
  async function go() {
    if (busyS) return
    busyS = true
    const was = S[1].s5, now = Math.min(99, was + 6)
    $('#syncSay') && ($('#syncSay').textContent = `B's reply says 5h is at ${now}%.`)
    S[1].from = was; S[1].s5 = now; S[1].ctx = Math.min(99, S[1].ctx + 4)
    draw()
    Sound.blip()
    await animate(600, t => { packets = [{ x: pathPt(1, t, true)[0], y: pathPt(1, t, true)[1], pct: now }]; draw() })
    storePulse = 1; packets = []; draw(); $('#syncSay').textContent = 'The store keeps the newest reading.'
    await wait(400)
    storePulse = 0
    await animate(700, t => { packets = [0, 2].map(k => ({ x: pathPt(k, t, false)[0], y: pathPt(k, t, false)[1], pct: now })); draw() })
    packets = []
    S[0].from = was; S[2].from = was; S[0].s5 = now; S[2].s5 = now
    draw()
    Sound.coin()
    $('#syncSay').textContent = `A and C pick up ${now}% on their next look.`
    await wait(1600)
    S.forEach(s => { s.from = 0 })
    busyS = false
  }
  const animate = (ms, f) => new Promise(res => {
    if (REDUCED) { f(1); return res() }
    const t0 = performance.now()
    const step = now => { const t = clamp((now - t0) / ms); f(ease.io(t)); t < 1 ? requestAnimationFrame(step) : res() }
    requestAnimationFrame(step)
  })
  draw()

  // The updater: a band, a button, and what git does
  addBand($('#updBand'), { k: () => 1.15, usd: false })
  const log = $('#updLog'), btn = $('#updBtn')
  log.innerHTML = '<div class="cmd">$ <span class="caret"></span></div><div>Press the button to watch the update run.</div>'
  const LINES = [
    ['cmd', '$ git rev-parse --show-prefix'], ['', '  (empty: the folder is its own clone)'],
    ['cmd', '$ git fetch --no-tags origin tag v1.1.0'], ['', '  * [new tag]  v1.1.0 -> v1.1.0'],
    ['cmd', '$ git merge --ff-only refs/tags/v1.1.0'], ['', '  Fast-forward'],
    ['', '↻ Claude Code reloads the mod from its folder'], ['ok', '✓ The crab updated himself to v1.1.0'],
  ]
  let running = false
  btn.addEventListener('click', async () => {
    if (running) return
    running = true
    btn.disabled = true
    btn.textContent = 'updating…'
    log.innerHTML = ''
    for (const [cls, text] of LINES) {
      const line = document.createElement('div')
      if (cls) line.className = cls
      log.appendChild(line)
      for (let i = 0; i <= text.length; i += 3) { line.textContent = text.slice(0, i); await wait(REDUCED ? 0 : 12) }
      line.textContent = text
      Sound.tick()
      await wait(REDUCED ? 0 : 220)
    }
    toast('The crab updated himself to v1.1.0', 'level')
    Sound.level()
    btn.textContent = 'Run it again'
    btn.disabled = false
    running = false
  })

  // The terminal's text bars, from the same state
  const term = $('#termDemo')
  const bar = (pct, cells = 5) => { const full = Math.round((Math.min(100, pct) / 100) * cells); return '▰'.repeat(full) + '▱'.repeat(cells - full) }
  const col = pct => ({ ok: 'c-cy', warn: 'c-yel', hot: 'c-red' })[H.tone(pct)]
  function drawTerm() {
    const v = viewOf()
    const list = H.tanksOf(snapNow(), snapNow(), Date.now())
    const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
    const face = H.FACES[H.moodOf(worst.pct)]
    const note = H.noteOf(worst)
    const g = st.gain
    const figs = list.map(t => `<span class="c-dim">${t.tag}</span> <span class="${col(t.pct)}">${bar(t.pct)}</span> <span class="c-b">${Math.round(t.pct)}%</span>`).join('  ')
    term.innerHTML = `<span class="c-dim">~/my-app $</span> claude\n<span class="c-dim">…</span>\n<span class="c-face">${esc(face)}</span>  <span class="c-mag">Lv${v.level}</span> <span class="c-mag" style="opacity:.6">${bar(v.frac * 100, 3)}</span>${g?.xp ? ` <span class="c-mag c-b">+${H.coinsLabel(g.xp)}xp</span>` : ''} <span class="c-yel" style="opacity:.7">●${H.coinsLabel(v.coins)}</span>${g?.coins ? ` <span class="c-yel c-b">+${H.coinsLabel(g.coins)}</span>` : ''}  <span class="c-dim">🔥${v.streak}</span>  ${figs}  <span class="c-dim">$${st.usd.toFixed(2)}</span>${note ? `  <span class="${col(worst.pct)}">${esc(note)}</span>` : ''}  <span class="c-dim">↻</span>\n<span class="c-dim">&gt;</span> <span style="background:#cfccc5">&nbsp;</span>`
    term.setAttribute('aria-label', `Terminal band: ${face} level ${v.level}, ${list.map(t => `${t.tag} ${Math.round(t.pct)}%`).join(', ')}`)
  }
  on('state', drawTerm)
  drawTerm()

  // What the store holds, live
  const priv = $('#privDemo')
  function drawPriv() {
    const p = st.p
    priv.innerHTML = `<span class="c-dim">// the mod's store: one file under ~/.claude</span>
{
  <span class="c-yel">"progress"</span>: { <span class="c-yel">"xp"</span>: ${Math.floor(p.xp)}, <span class="c-yel">"coins"</span>: ${p.coins}, <span class="c-yel">"turns"</span>: ${p.turns}, … },
  <span class="c-yel">"readings"</span>: [
    { <span class="c-yel">"kind"</span>: <span class="c-cy">"five_hour"</span>, <span class="c-yel">"pct"</span>: ${Math.round(st.s5)}, … },
    { <span class="c-yel">"kind"</span>: <span class="c-cy">"seven_day"</span>, <span class="c-yel">"pct"</span>: ${Math.round(st.s7)}, … }
  ],
  <span class="c-yel">"latest"</span>: { <span class="c-yel">"tag"</span>: <span class="c-cy">"v1.0.0"</span>, … },
  <span class="c-yel">"hidden"</span>: ${st.hidden}
}`
  }
  on('state', drawPriv)
  drawPriv()
}

// ------------------------------------------------------------------ 07 reel
{
  const teaser = $('#teaser'), modal = $('#reelModal'), video = $('#reelVideo')
  // H.264 where the browser has it, AV1 in WebM where it doesn't (open-source Chromium builds)
  const mp4 = !!video.canPlayType('video/mp4; codecs="avc1.640028"')
  const REEL = mp4 ? 'reel.mp4' : 'reel.webm', TEASER = mp4 ? 'reel-teaser.mp4' : 'reel-teaser.webm'
  let teaserOn = false
  const reelSec = $('#reel')
  new IntersectionObserver(es => {
    const vis = es[0].isIntersecting
    if (vis && !REDUCED) {
      if (!teaserOn) { teaserOn = true; teaser.src = TEASER }
      teaser.play().catch(() => {})
    } else if (teaserOn) teaser.pause()
  }, { threshold: .25 }).observe(reelSec)
  teaser.addEventListener('playing', () => { teaser.style.opacity = '1' })
  teaser.style.opacity = '0'
  teaser.style.transition = 'opacity .6s'
  let opener = null, triedBlob = false
  const fail = () => {
    if (!triedBlob) {
      triedBlob = true
      fetch(REEL).then(r => (r.ok ? r.blob() : Promise.reject())).then(b => { video.src = URL.createObjectURL(b); video.play().catch(() => {}) }).catch(() => {
        $('#modalInner').insertAdjacentHTML('beforeend', '<div class="modal-fail"><p>This viewer wouldn\'t play the video.</p></div>')
      })
    }
  }
  video.addEventListener('error', fail)
  function open(e) {
    opener = e.currentTarget
    modal.hidden = false
    if (!video.src) video.src = REEL
    video.currentTime = 0
    video.play().catch(() => {})
    teaser.pause()
    $('#modalClose').focus()
    document.body.style.overflow = 'hidden'
  }
  function close() {
    modal.hidden = true
    video.pause()
    document.body.style.overflow = ''
    if (teaserOn) teaser.play().catch(() => {})
    opener?.focus()
  }
  $$('[data-reel]').forEach(b => b.addEventListener('click', open))
  $('#modalClose').addEventListener('click', close)
  modal.addEventListener('click', e => { if (e.target === modal) close() })
  addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close() })
}

// ------------------------------------------------------------------ 08 install
$$('[data-itab]').forEach(b => b.addEventListener('click', () => {
  $$('[data-itab]').forEach(x => x.setAttribute('aria-selected', String(x === b)))
  $$('[data-ipanel]').forEach(p => { p.hidden = p.dataset.ipanel !== b.dataset.itab })
}))
$$('.copy').forEach(b => b.addEventListener('click', async () => {
  const pre = document.getElementById(b.dataset.copy)
  const text = pre.textContent
  const done = () => { b.textContent = 'Copied'; b.classList.add('done'); Sound.blip(); setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done') }, 1600) }
  try { await navigator.clipboard.writeText(text); done() } catch {
    const r = document.createRange(); r.selectNodeContents(pre)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    b.textContent = 'Press ⌘C'
    setTimeout(() => { b.textContent = 'Copy' }, 2200)
  }
}))

// ------------------------------------------------------------------ footer: the wordmark is made of the band's cells
{
  const cv = $('#wordmark'), cx = cv.getContext('2d'), foot = watch($('#foot'))
  const TEXT = 'CLAUDE-USAGE-MOD'
  let cells = [], cs = 10, W = 0, Hh = 0, px = -9999, py = -9999, fillT = 0, seen = false
  function build() {
    const w = cv.clientWidth
    const { w: tw } = pixD(TEXT)
    cs = w / tw
    W = w; Hh = Math.round(cs * 5 + cs * 2)
    const dpr = Math.min(2, devicePixelRatio || 1)
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.height = `${Hh}px`
    cx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cells = []
    let x = 0
    for (const ch of TEXT) {
      const g = glyphOf(ch)
      const gw = Math.max(...g.map(r => r.length))
      g.forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') cells.push({ hx: (x + i) * cs, hy: (y + 1) * cs, x: (x + i) * cs, y: (y + 1) * cs, vx: 0, vy: 0, heat: 0, col: x + i }) })
      x += gw + 1
    }
  }
  cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); px = e.clientX - r.left; py = e.clientY - r.top })
  cv.addEventListener('pointerleave', () => { px = py = -9999 })
  addEventListener('resize', () => { W = 0 })
  const lit = [H.CLAWD, '#e08a6c', '#c4a05a', '#6b9e7a']
  tickers.add((dt, t) => {
    if (!isNear(foot)) return
    if (!W || W !== cv.clientWidth) build()
    if (!seen && foot.getBoundingClientRect().top < vh * .85) seen = true
    if (seen) fillT = REDUCED ? 1 : Math.min(1, fillT + dt * .7)
    const total = cells.length ? cells[cells.length - 1].col + 1 : 1
    cx.clearRect(0, 0, W, Hh)
    const R = cs * 5
    for (const c of cells) {
      if (!REDUCED) {
        const dx = c.x - px, dy = c.y - py, d = Math.hypot(dx, dy)
        if (d < R && d > .01) { const f = (1 - d / R) ** 2 * 2600; c.vx += (dx / d) * f * dt; c.vy += (dy / d) * f * dt; c.heat = 1 }
        c.vx += (c.hx - c.x) * 90 * dt; c.vy += (c.hy - c.y) * 90 * dt
        c.vx *= Math.exp(-dt * 9); c.vy *= Math.exp(-dt * 9)
        c.x += c.vx * dt; c.y += c.vy * dt
      }
      c.heat = Math.max(0, c.heat - dt * 1.6)
      const on = c.col / total < ease.out(fillT)
      cx.fillStyle = c.heat > .05 ? lit[(c.col + Math.floor(t * 6)) % lit.length] : on ? '#efebe4' : '#23262d'
      const g = Math.max(1, cs * .12)
      cx.fillRect(Math.round(c.x), Math.round(c.y), Math.ceil(cs - g), Math.ceil(cs - g))
    }
  })
  const sleeper = $('#sleeper')
  let awake = false
  const drawSleeper = () => {
    const o = { ...outfitNow() }; delete o.scene
    sleeper.innerHTML = `<svg viewBox="-2 -6 52 32" shape-rendering="crispEdges">${H.clawdSvg(awake ? 'happy' : 'asleep', 'idle', o, awake, true)}</svg>`
  }
  drawSleeper()
  on('progress', drawSleeper)
  on('read', pct => { if (pct >= 99 && awake) { awake = false; drawSleeper() } })
  sleeper.addEventListener('click', () => {
    awake = true; drawSleeper(); Sound.level()
    $('#footTitle').textContent = "He's up. Back to the top."
    setTimeout(() => scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }), 700)
    setTimeout(() => { $('#footTitle').textContent = "You read the whole page. He's out cold." }, 2500)
  })
}

// ------------------------------------------------------------------ cursor label and magnetic buttons
if (FINE && !REDUCED) {
  const tag = $('#cursorTag')
  let tx = -100, ty = -100, x = -100, y = -100, label = ''
  addEventListener('pointermove', e => {
    tx = e.clientX; ty = e.clientY
    const t = e.target.closest?.('[data-cursor]')
    const want = t ? t.dataset.cursor : ''
    if (want !== label) { label = want; tag.textContent = want; tag.classList.toggle('on', !!want) }
  }, { passive: true })
  document.addEventListener('pointerleave', () => { label = ''; tag.classList.remove('on') })
  tickers.add(dt => {
    x = lerp(x, tx, 1 - Math.exp(-dt * 22)); y = lerp(y, ty, 1 - Math.exp(-dt * 22))
    tag.style.transform = `translate3d(${r2(x + 16)}px, ${r2(y + 18)}px, 0)`
  })
  $$('.magnetic').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
      el.style.transform = `translate(${r2(dx * .18)}px, ${r2(dy * .3)}px)`
    })
    el.addEventListener('pointerleave', () => { el.style.transform = '' })
  })
}

// ------------------------------------------------------------------ for the WebGL crab (voxel.js)
window.SITE = {
  H, st, on, fire, emit, REDUCED, FINE, Sound,
  parseSprite, rectAt, smilAt,
  mood: moodNow,
  outfit: () => { const o = { ...outfitNow() }; delete o.scene; return o },
  fitOutfit,
  crabSvg: (mood, opts = {}) => H.clawdSvg(mood, opts.doing ?? 'idle', opts.outfit ?? window.SITE.outfit(), opts.burst ?? st.burst, opts.props ?? true),
  heroStage: () => heroStage,
  heroBand: () => heroBand,
  heroTurn,
  glOn(where) {
    if (where === 'hero') hero.classList.add('gl-on')
    if (where === 'fit') { $('#fitting').classList.add('gl-on'); fitLabel() }
  },
  landed(on) { heroBandEl.classList.toggle('hide-crab', !on); if (on) { heroBandEl.classList.remove('landing'); void heroBandEl.offsetWidth; heroBandEl.classList.add('landing') } },
  setVoxCount(n) { $('#voxCount').textContent = String(n) },
}

// first paint: the hero band sweeps in from empty
st.prev = { ...snapNow(), ctxPct: 0, limits: [{ kind: 'five_hour', pct: 0 }, { kind: 'seven_day', pct: 0 }] }
setTimeout(() => { st.prev = null; emit() }, H.SWEEP_MS + 900)
emit(true)
requestAnimationFrame(frame)
})()
