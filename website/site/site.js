// claude-usage-mod: the site. Every crab, band and outfit is drawn by the mod's own code (hud.js);
// this file is the sheet around it: the demo's state, the line figures, and the controls.
'use strict'

const H = window.HUD

// ------------------------------------------------------------------ utilities
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const wait = ms => new Promise(r => setTimeout(r, ms))
const rand = (a, b) => a + Math.random() * (b - a)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches
const fmt = n => Math.round(n).toLocaleString('en-US')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// The mod's own strings name the mascot; this page calls him the crab.
const clean = s => String(s).replace(/^Clawd's/, "The crab's").replace(/^Clawd\b/, 'The crab').replace(/\bClawd's/g, "the crab's").replace(/\bClawd\b/g, 'the crab')
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem('cum:' + k)) } catch { return null } },
  set(k, v) { try { localStorage.setItem('cum:' + k, JSON.stringify(v)) } catch {} },
}
const listeners = {}
const on = (k, f) => (listeners[k] ||= new Set()).add(f)
const fire = (k, v) => listeners[k]?.forEach(f => f(v))
const gridD = (g, ch = '#', p = 1, ox = 0, oy = 0) => H.pixels(g, ox, oy, p, ch)
const COIN_SVG = `<svg viewBox="0 0 5 5" shape-rendering="crispEdges" aria-hidden="true"><path d="${gridD(H.COIN)}" fill="${H.COLORS.coin}"/></svg>`
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const svgFit = svg => svg.replace(/\swidth="[\d.]+"\sheight="[\d.]+"/, '')

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
const iso8601 = ms => new Date(ms).toISOString()
function snapNow() {
  return {
    ctxPct: Math.round(st.ctx), ctxTokens: Math.round(st.ctx * 10_000), ctxWindow: 1_000_000,
    limits: [
      { kind: 'five_hour', pct: Math.round(st.s5), resetsAt: iso8601(st.reset5) },
      { kind: 'seven_day', pct: Math.round(st.s7), resetsAt: iso8601(st.reset7) },
    ],
    usd: st.usd,
  }
}
function startProgress() {
  const p = H.newProgress()
  const day = H.dayOf(Date.now())
  p.xp = Math.round(H.xpFor(12) + 0.35 * (H.xpFor(13) - H.xpFor(12)))
  p.coins = 2400
  p.turns = 640
  p.tokensIn = 48_200_000
  p.tokensOut = 1_910_000
  p.streak = { count: 12, best: 21, lastDay: day, restDays: 1 }
  p.today = { day, turns: 14 }
  p.badges = { 'first-steps': day, 'on-a-roll': day, 'deep-thinker': day }
  p.windows = { five_hour: { resetsAt: iso8601(st.reset5), peak: st.s5 }, seven_day: { resetsAt: iso8601(st.reset7), peak: st.s7 } }
  // He starts with headphones and nothing else; the level unlocks wait in the shop.
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
let flushQueued = false
function emit(restart = false) {
  pending = Math.max(pending, restart ? 2 : 1)
  if (!flushQueued) { flushQueued = true; requestAnimationFrame(flush) }
}
function flush() {
  flushQueued = false
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
  }
  if (is > was) {
    st.burst = true
    clearTimeout(burstTimer)
    burstTimer = setTimeout(() => { st.burst = false; emit() }, 2600)
    toastLevel(was, is)
  }
  for (const line of step.news) toast(clean(line), /Badge/.test(line) ? 'badge' : /Maxed/.test(line) ? 'level' : 'crab')
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
      if (crossed) toast(`${name} limit passed ${crossed}%`, 'sweat')
    }
  }
  if (opts.game !== false) apply(H.afterMeasure(st.p, snapNow(), opts.at ?? Date.now(), prevCtx))
  else emit(true)
}

// ------------------------------------------------------------------ toasts
const ICONS = {
  crab: () => `<svg viewBox="6 3 30 22" shape-rendering="crispEdges">${H.clawdSvg('happy', 'idle', {}, false, false)}</svg>`,
  sweat: () => `<svg viewBox="2 3 32 22" shape-rendering="crispEdges">${H.clawdSvg('frantic', 'idle', {}, false, false)}</svg>`,
  level: () => `<svg viewBox="0 0 3 3" shape-rendering="crispEdges" style="width:14px"><path d="${gridD(H.SPARKLE)}" fill="${H.COLORS.shine}"/></svg>`,
  badge: () => `<svg viewBox="0 0 5 5" shape-rendering="crispEdges" style="width:14px"><path d="${gridD(['.###.', '#####', '#####', '.###.', '.#.#.'])}" fill="${H.COLORS.golden}"/></svg>`,
}
const appEl = $('#app')
function toast(text, icon = 'crab', ms = 3600) {
  const r = appEl.getBoundingClientRect()
  const inApp = r.top < innerHeight - 120 && r.bottom > 160
  const host = inApp ? $('#appToasts') : $('#toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.innerHTML = `${(ICONS[icon] || ICONS.crab)()}<span>${esc(text)}</span>`
  host.appendChild(el)
  while (host.children.length > 3) host.firstElementChild.remove()
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320) }, ms)
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
  const width = Math.max(140, Math.floor(cw / k))
  const view = b.view ? b.view() : viewOf()
  const doing = b.doing ? b.doing() : st.doing
  const cur = snapNow()
  const list = H.tanksOf(cur, st.prev ?? cur, Date.now())
  const svg = st.hidden && b.hideable
    ? `<svg viewBox="0 0 ${width} 24" width="${width}" height="24"></svg>`
    : H.pixelSvg(list, b.usd === false ? undefined : st.usd, doing, width, view)
  b.el.style.setProperty('--k', k)
  b.el.style.setProperty('--w', width)
  const old = b.el.firstElementChild
  let t = 0
  try { if (old && !restart && old.getCurrentTime) t = old.getCurrentTime() } catch {}
  b.el.innerHTML = svg
  const ns = b.el.firstElementChild
  try { if (t && ns.setCurrentTime) ns.setCurrentTime(t) } catch {}
  if (REDUCED) try { ns.pauseAnimations() } catch {}
  b.width = width
  b.onDraw?.(b, view, list)
}
const readOf = () => `ctx ${Math.round(st.ctx)}% · 5h ${Math.round(st.s5)}% · 7d ${Math.round(st.s7)}%`

// ------------------------------------------------------------------ top bar: frosted once scrolled, a dot on the section in view
{
  const bar = $('#topbar'), dot = $('#navDot'), nav = $('#nav')
  const links = $$('a[href^="#"]', nav)
  const sections = $$('main > section')
  let active = null
  const pick = () => {
    bar.toggleAttribute('data-scrolled', scrollY > 8)
    const line = innerHeight * 0.35
    let hit = null
    for (const s of sections) if (s.getBoundingClientRect().top < line) hit = s.id
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) hit = 'install'
    if (hit === active) return
    active = hit
    links.forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === `#${hit}`))
    const link = links.find(a => a.getAttribute('href') === `#${hit}` && a.offsetParent)
    if (!link) { dot.style.opacity = '0'; return }
    dot.style.translate = `${link.getBoundingClientRect().left - nav.getBoundingClientRect().left + 2}px 0`
    dot.style.opacity = '1'
  }
  addEventListener('scroll', pick, { passive: true })
  addEventListener('resize', () => { active = undefined; pick() })
  pick()
}

// ------------------------------------------------------------------ entrances: each block rises in as it scrolls into view
{
  const blocks = $$('[data-reveal]')
  if (!('IntersectionObserver' in window)) blocks.forEach(b => b.setAttribute('data-shown', ''))
  else {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.setAttribute('data-shown', ''); io.unobserve(e.target) }
    }), { threshold: 0.12 })
    blocks.forEach(b => io.observe(b))
  }
}

// ------------------------------------------------------------------ copy buttons: the clipboard blurs away as the tick grows in
$$('[data-copy]').forEach(b => b.addEventListener('click', () => {
  const text = b.dataset.copy
  const done = () => { b.setAttribute('data-copied', ''); b.setAttribute('aria-label', 'Copied'); setTimeout(() => b.removeAttribute('data-copied'), 1600) }
  const fallback = () => {
    const line = b.parentElement.querySelector('.pill-line, pre')
    if (!line) return
    const range = document.createRange()
    range.selectNodeContents(line)
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range)
    toast('Selected. Press Cmd+C or Ctrl+C to copy.', 'crab', 2600)
  }
  try { navigator.clipboard.writeText(text).then(done, fallback) } catch { fallback() }
}))

// ------------------------------------------------------------------ hero
{
  // the phrase that swaps: the old one blurs up and out as the new one rises out of a blur
  const box = $('#swap')
  const items = ['always <em>in view</em>.', 'watched by a <em>crab</em>.', 'paid out in <em>hats</em>.']
  let now = 0
  const size = () => { const c = box.lastElementChild; if (c) box.style.width = `${c.offsetWidth}px` }
  document.fonts?.ready.then(size)
  addEventListener('resize', size)
  let paused = false
  const title = box.closest('h1')
  title.addEventListener('pointerenter', () => (paused = true))
  title.addEventListener('pointerleave', () => (paused = false))
  if (!REDUCED) setInterval(() => {
    if (paused || document.hidden) return
    now = (now + 1) % items.length
    const was = box.lastElementChild
    was.className = 'swap-out'
    const next = document.createElement('span')
    next.className = 'swap-in'
    next.innerHTML = items[now]
    box.appendChild(next)
    size()
    setTimeout(() => was.remove(), 340)
  }, 3400)
  size()

  // the ring turns slowly, faster under the pointer
  const ring = $('#ring'), text = $('#ringText')
  const spin = REDUCED ? null : text.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 32000, iterations: Infinity })
  ring.addEventListener('pointerenter', () => spin && (spin.playbackRate = 4))
  ring.addEventListener('pointerleave', () => spin && (spin.playbackRate = 1))

  const crab = $('#heroCrab')
  const drawCrab = () => {
    const v = viewOf()
    crab.innerHTML = H.clawdSvg(moodNow(), st.doing, v.outfit, v.burst, true)
    if (REDUCED) try { crab.pauseAnimations() } catch {}
  }
  on('state', drawCrab)
  drawCrab()
  $('#brandCrab').innerHTML = H.clawdSvg('happy', 'idle', {}, false, false)
  $('#footCrab').innerHTML = H.clawdSvg('happy', 'idle', {}, false, false)

  const heroBand = addBand($('#heroBand'), { k: () => (innerWidth < 700 ? 1.25 : 1.75), hideable: false })
  heroBand.onDraw = () => { $('#heroRead').textContent = readOf() }
  $('#heroRefresh').addEventListener('click', () => emit(true))

  $('#statItems').textContent = Object.keys(H.ITEMS).length
  $('#statItems').dataset.to = Object.keys(H.ITEMS).length
  // the figures count up once the strip is in view
  const strip = $('#stats')
  if (!REDUCED) {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      $$('.stat-n', strip).forEach(el => {
        const to = +el.dataset.to, t0 = performance.now()
        const step = now => {
          const t = clamp((now - t0) / 1400)
          el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)))
          if (t < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    }, { threshold: 0.6 })
    io.observe(strip)
  }
}

// ------------------------------------------------------------------ 01 the band: the desktop app's Code tab
const convo = $('#convo'), convoEmpty = $('#convoEmpty'), input = $('#promptInput'), sendBtn = $('#sendBtn')
let manualDoing = null
addBand($('#appBand'), {
  k: () => (innerWidth < 700 ? 1.15 : 1.4),
  doing: () => manualDoing ?? st.doing,
  hideable: true,
  onDraw: (b, view, list) => ladder(b.width, view, list),
})
function ladder(width, view, list) {
  const worst = list.reduce((a, b) => (b.pct > a.pct ? b : a))
  const sizes = view ? { full: H.gameSvg(view, 0, 'full').width, short: H.gameSvg(view, 0, 'short').width } : undefined
  const plan = H.planOf(width, list, st.usd, worst, sizes)
  const long = H.noteOf(worst), short = H.shortNoteOf(worst)
  const set = (k, state) => { const li = $(`#ladder [data-k="${k}"]`); li.classList.toggle('off', state === 'off'); li.classList.toggle('na', state === 'na') }
  set('cluster', plan.game !== 'none' ? 'on' : 'off')
  set('streak', plan.game === 'full' && view.streak >= 3 ? 'on' : 'off')
  set('note', !long ? 'na' : plan.note === long ? 'on' : 'off')
  set('cost', plan.showUsd ? 'on' : 'off')
  set('short', !short || plan.note === long ? 'na' : plan.note === short ? 'on' : 'off')
  set('bars', plan.mode === 'bars' ? 'on' : 'off')
  set('all', plan.mode !== 'tiny' ? 'on' : 'off')
}
const SUGGEST = ['Fix the flaky login test', 'Refactor the auth module', 'Write tests for the parser', 'Why does this crash?']
$('#chips').innerHTML = SUGGEST.map(s => `<button class="chip" type="button">${esc(s)}</button>`).join('')
$$('#chips .chip').forEach(c => c.addEventListener('click', () => send(c.textContent)))
const REPLIES = [
  [/flaky|fix|bug/i, 'Edit tests/login.spec.ts', 'Found it. The test raced the session timer, so it now waits for the redirect. It passed 50 runs in a row.'],
  [/refactor|clean/i, 'Edit src/auth/session.ts', 'Split the session store out of the auth module and kept the public API the same. All 42 tests still pass.'],
  [/test|parser|spec/i, 'Write tests/parser.test.ts', 'Added 18 cases for the parser, including an empty file and an unclosed string. One of them caught a real bug, which I fixed.'],
  [/why|crash|error|stack|explain/i, 'Read logs/crash.txt', 'The retry loop never resets its counter, so the fourth retry reads a closed socket. The fix is one line in net/retry.ts.'],
  [/hi|hello|hey|crab/i, 'Read README.md', 'Hi! These replies are canned, but the crab is real. Watch the bars under this message.'],
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
  if (msgs.length > 5) msgs[0].remove()
  return el
}
function setDoing(d) { st.doing = d; manualDoing = null; syncSeg(); emit() }
async function command(text) {
  const [, verb = ''] = text.trim().split(/\s+/)
  addMsg('user', esc(text))
  await wait(250)
  if (/^stats$/i.test(verb)) {
    addMsg('bot', `<div class="tool"><i></i><b>/usage-hud stats</b></div>${esc(clean(H.statsOf(st.p, Date.now()))).replace(/\n/g, '<br>')}`)
  } else if (/^(shop|wear|buy)$/i.test(verb)) {
    addMsg('bot', 'Opening the shop below.')
    await wait(400); $('#shop').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' })
  } else if (/^update$/i.test(verb)) {
    addMsg('bot', 'You are on the newest release, v1.0.0. How updates install is further down.')
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
  if (st.s5 >= 100 || st.s7 >= 100) {
    await wait(500)
    addMsg('bot', `You've hit your ${st.s7 >= 100 ? 'weekly' : '5-hour'} limit, so Claude can't reply until it resets in ${H.untilReset((st.s7 >= 100 ? st.reset7 : st.reset5) - Date.now())}. The crab is asleep. Press <b>Reset it</b> to wake him.`)
    busy = false; sendBtn.disabled = false
    return
  }
  setDoing('thinking')
  await wait(REDUCED ? 300 : rand(1100, 1700))
  setDoing('typing')
  const [, tool, reply] = REPLIES.find(([re]) => re.test(text))
  const el = addMsg('bot', `<div class="tool"><i></i><b>${esc(tool)}</b></div><span class="txt"></span><span class="cursor"></span>`)
  const txt = $('.txt', el)
  const words = reply.split(' ')
  for (let i = 0; i < words.length; i++) {
    txt.textContent += (i ? ' ' : '') + words[i]
    await wait(REDUCED ? 0 : rand(28, 70))
  }
  $('.cursor', el)?.remove()
  setDoing('idle')
  // The reply's usage: the context grows, both limits move, and the turn pays out.
  const out = Math.round(rand(1800, 3600))
  st.tools += Math.round(rand(1, 4))
  st.usd = Math.round((st.usd + rand(0.08, 0.32)) * 100) / 100
  apply(H.afterTurn(st.p, { now: Date.now(), usage: { input_tokens: 24_000, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, tools: st.tools }), { say: false })
  measure({ ctx: st.ctx + rand(3, 7), s5: st.s5 + rand(5, 11), s7: st.s7 + rand(1, 3) })
  busy = false
  sendBtn.disabled = false
}
$('#promptForm').addEventListener('submit', e => { e.preventDefault(); send(input.value) })
$('#appRefresh').addEventListener('click', () => emit(true))
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
  })
}
function syncSeg() { $$('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.doing === (manualDoing ?? st.doing)))) }
$$('.seg button').forEach(b => b.addEventListener('click', () => { manualDoing = b.dataset.doing; st.doing = b.dataset.doing; syncSeg(); emit() }))
on('state', syncSliders)
$('#maxBtn').addEventListener('click', () => {
  if (st.s5 >= 100) return toast('Already maxed. He sleeps until the window resets.', 'crab')
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
  const handle = $('#resize'), holder = $('#appHolder'), out = $('#widthRead')
  let w = null, sx = 0, sw = 0
  const room = () => holder.clientWidth - 28
  const show = () => { out.textContent = `${fmt(appEl.offsetWidth)} px` }
  const setW = px => {
    const max = room()
    w = clamp(Math.round(px), 220, max)
    appEl.style.width = w >= max - 1 ? '' : `${w}px`
    handle.setAttribute('aria-valuenow', String(w))
    handle.setAttribute('aria-valuemax', String(max))
  }
  // the handle rides the window's right edge
  const place = () => { handle.style.left = `${14 + appEl.offsetWidth - 7}px`; handle.style.right = 'auto'; show() }
  new ResizeObserver(place).observe(appEl)
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
  // A hint: the window narrows once on its own when it first comes into view, then springs back.
  let shown = false
  new IntersectionObserver(es => {
    if (shown || REDUCED || !es[0].isIntersecting) return
    shown = true
    const max = room(), to = Math.max(300, max * 0.5)
    const io = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const t0 = performance.now() + 600
    const run = now => {
      const t = (now - t0) / 2600
      if (t >= 1 || w !== null) { if (w === null) appEl.style.width = ''; return }
      const k = t < 0 ? 0 : t < 0.45 ? io(t / 0.45) : t < 0.6 ? 1 : 1 - io((t - 0.6) / 0.4)
      appEl.style.width = `${lerp(max, to, k)}px`
      requestAnimationFrame(run)
    }
    requestAnimationFrame(run)
  }, { threshold: 0.55 }).observe(appEl)
}

// ------------------------------------------------------------------ the line figures' kit
// One isometric projection, a few solids, and a stage that knows where the pointer is, keeps its
// own clock while on screen, and redraws its figure one frame at a time. White faces painted back
// to front, a bright hull, a dim crease, orange for what is happening.
const FW = 400, FH = 320
const C30 = Math.cos(Math.PI / 6)
const isoP = (ox, oy, k = 1) => Object.assign((x, y, z = 0) => [ox + k * C30 * (x - y), oy + k * (0.5 * (x + y) - z)], { ox, oy, k })
const n1 = v => v.toFixed(1)
const dP = (pts, close = true) => 'M' + pts.map(p => n1(p[0]) + ' ' + n1(p[1])).join('L') + (close ? 'Z' : '')
const ease3 = t => ((t = clamp(t)) < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
function box(P, { x, y, z = 0, w, dp, h, tone, top, inner = '' }) {
  const a = P(x, y, z + h), b = P(x + w, y, z + h), c = P(x + w, y + dp, z + h), e = P(x, y + dp, z + h)
  const b0 = P(x + w, y, z), c0 = P(x + w, y + dp, z), e0 = P(x, y + dp, z)
  const hull = dP([a, b, b0, c0, e0, e])
  if (tone === 'ghost') return `<path d="${hull}" class="d"/>`
  return `<g><path d="${hull}" class="f"/>${top ? `<path d="${dP([a, b, c, e])}" class="${top}"/>` : ''}<path d="${dP([e, c, b], false)}${h > 0 ? dP([c, c0], false) : ''}" class="c"/>${inner}<path d="${hull}" class="${tone === 'o' ? 'o' : 's'}"/></g>`
}
function can(P, { x, y, z = 0, r, h, tone, fill = 'f' }) {
  const [cx, cy] = P(x, y, z + h), [, by] = P(x, y, z)
  const rx = r * 1.2247 * P.k, ry = r * 0.7071 * P.k
  const side = `M${n1(cx - rx)} ${n1(cy)}L${n1(cx - rx)} ${n1(by)}A${n1(rx)} ${n1(ry)} 0 0 0 ${n1(cx + rx)} ${n1(by)}L${n1(cx + rx)} ${n1(cy)}`
  const cls = tone === 'o' ? 'o' : 's'
  return `<g>${h > 0 ? `<path d="${side}Z" class="f"/><path d="${side}" class="${cls}"/>` : ''}<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" class="${fill}"/><ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" class="${cls}"/></g>`
}
const quad = (P, x, y, w, dp, z = 0) => dP([P(x, y, z), P(x + w, y, z), P(x + w, y + dp, z), P(x, y + dp, z)])
const PLANES = { floor: 'matrix(0.866 0.5 -0.866 0.5 0 0)', floorY: 'matrix(0.866 -0.5 0.866 0.5 0 0)', wall: 'matrix(0.866 0.5 0 1 0 0)', wallY: 'matrix(0.866 -0.5 0 1 0 0)' }
const label = (P, x, y, z, text, plane = 'floor', cls = 't') => { const [px, py] = P(x, y, z); return `<g transform="translate(${n1(px)} ${n1(py)})"><text transform="${PLANES[plane]}" class="${cls}">${esc(text)}</text></g>` }

// A pixel crab in the figures' own line style: orange cells, white eyes.
const CRAB = ['XX.........XX', 'X.X.......X.X', '.XX.......XX.', '..X.XXXXX.X..', '..XXXXXXXXX..', '...XEXXXEX...', '...XXXXXXX...', '..X.X...X.X..', '.X..X...X..X.']
const SNAP = ['..X.......X..', '.XX.......XX.', '..X.......X..']
function pixelCrab(px, { snap = false, look = 0, sleep = false, cls = 'of' } = {}) {
  const rows = snap ? [...SNAP, ...CRAB.slice(3)] : CRAB
  let s = ''
  rows.forEach((row, r) => [...row].forEach((c, k) => {
    if (c !== '.') s += `<rect x="${n1(k * px)}" y="${n1(r * px)}" width="${n1(px + 0.4)}" height="${n1(px + 0.4)}" class="${c === 'E' ? 'f' : cls}"/>`
  }))
  for (const k of [4, 8]) {
    s += sleep
      ? `<rect x="${n1(k * px + px * 0.1)}" y="${n1(5 * px + px * 0.55)}" width="${n1(px * 0.8)}" height="${n1(px * 0.18)}" class="k"/>`
      : `<rect x="${n1(k * px + px * 0.3 + look * px * 0.2)}" y="${n1(5 * px + px * 0.2)}" width="${n1(px * 0.45)}" height="${n1(px * 0.6)}" class="k"/>`
  }
  return s
}

function stage(host, { draw, read, onRead, idle = t => [0.5 + 0.32 * Math.sin(t * 0.55), 0.5 + 0.22 * Math.sin(t * 0.4 + 1)], still = 2.4 }) {
  host.innerHTML = `<svg viewBox="0 0 ${FW} ${FH}" aria-hidden="true"></svg>`
  const svg = host.firstElementChild
  const out = host.closest('.stage')?.querySelector('.corner.bottom .readout')
  let t = still, [x, y] = idle(still), tx = 0.5, ty = 0.5, over = false, raf = 0, last = 0, said = ''
  const paint = still => {
    const f = { t, x, y, over, still }
    svg.innerHTML = draw(f)
    if (read) {
      const s = read(f)
      if (s !== said) { said = s; if (out) out.textContent = s; onRead?.(s, f) }
    }
  }
  const move = e => {
    const r = host.getBoundingClientRect()
    tx = clamp((e.clientX - r.left) / r.width)
    ty = clamp((e.clientY - r.top) / r.height)
    over = true
    if (REDUCED) { x = tx; y = ty; paint(true) }
  }
  const leave = () => { over = false; if (REDUCED) { [x, y] = idle(t); paint(true) } }
  host.addEventListener('pointermove', move)
  host.addEventListener('pointerdown', move)
  host.addEventListener('pointerleave', leave)
  host.addEventListener('pointercancel', leave)
  const tick = now => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    t += dt
    const [ix, iy] = over ? [tx, ty] : idle(t)
    const k = 1 - Math.exp(-dt * (over ? 9 : 4))
    x += (ix - x) * k
    y += (iy - y) * k
    paint(false)
    raf = requestAnimationFrame(tick)
  }
  if (!REDUCED) {
    new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      last = 0
      if (e.isIntersecting) raf = requestAnimationFrame(tick)
    }).observe(host)
  }
  paint(REDUCED)
}

// ------------------------------------------------------------------ 02 moods
const MOODS = [
  { id: 'happy', name: 'Happy', range: 'Under 50%', desc: 'Headphones on, notes drifting by. Nothing to think about.' },
  { id: 'anxious', name: 'Anxious', range: '50% and up', desc: 'Sipping coffee a little too fast, with a note saying which limit is filling up.' },
  { id: 'frantic', name: 'Frantic', range: '80% and up', desc: 'A clock ticks over his head, counting down to the reset.' },
  { id: 'panic', name: 'Panic', range: '95% and up', desc: 'Flames on both sides. He is sure this is fine.' },
  { id: 'asleep', name: 'Asleep', range: '100%', desc: 'Out cold until the window resets. Hitting it still pays out XP.' },
]
const moodById = id => MOODS.find(m => m.id === id)
{
  const P = isoP(200, 176, 1.38)
  const HX = 92, HY = 62, TH = 10, SEG = 10, PX = 4.4 * 1.38
  const usage = f => Math.round(100 * clamp((0.82 - f.y) / 0.64))
  const flame = (x, y, s, cls) => `<path d="M${n1(x)} ${n1(y)}c${n1(-5 * s)} ${n1(-5 * s)} ${n1(-4 * s)} ${n1(-10 * s)} 0 ${n1(-17 * s)}c${n1(1 * s)} ${n1(5 * s)} ${n1(5 * s)} ${n1(6 * s)} ${n1(4 * s)} ${n1(11 * s)}c${n1(-0.5 * s)} ${n1(3 * s)} ${n1(-2 * s)} ${n1(5 * s)} ${n1(-4 * s)} ${n1(6 * s)}z" class="${cls}"/>`
  function draw(f) {
    const pct = usage(f)
    const m = H.moodOf(pct)
    const lit = Math.round((pct / 100) * SEG)
    const moving = !f.still && m !== 'asleep'
    const beat = m === 'happy' ? 1.4 : m === 'anxious' ? 0.6 : 0.22
    const snap = moving && Math.floor(f.t / beat) % 2 === 1
    const shake = moving && (m === 'frantic' || m === 'panic') ? Math.sin(f.t * 40) * (m === 'panic' ? 1.2 : 0.8) : 0
    const bob = moving ? Math.abs(Math.sin(f.t * (m === 'happy' ? 2 : 4))) * -2 : 0
    const [bx, by] = P(-6, 6, TH)
    const left = bx - (13 * PX) / 2 + shake, topY = by - 9 * PX - 4 + bob
    const look = m === 'happy' ? 0 : m === 'anxious' ? 1 : -1
    let s = box(P, {
      x: -HX, y: -HY, w: 2 * HX, dp: 2 * HY, h: TH,
      inner:
        `<path d="${dP([P(-HX, -HY + 14, TH), P(HX, -HY + 14, TH)], false)}" class="c"/>` +
        [0, 1, 2].map(i => { const [cx, cy] = P(-HX + 9 + i * 8, -HY + 7, TH); return `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="2.4" ry="1.4" class="c"/>` }).join('') +
        [0, 1, 2, 3].map(i => `<path d="${dP([P(-HX + 10, -HY + 26 + i * 10, TH), P(-HX + 40 + ((i * 37) % 60), -HY + 26 + i * 10, TH)], false)}" class="c"/>`).join('') +
        Array.from({ length: SEG }, (_, i) => `<path d="${quad(P, -HX + 12 + i * 16.8, HY - 20, 13, 9, TH)}" class="${i < lit ? (pct >= 80 ? 'of' : 'ot') : 'c'}"/>`).join('') +
        label(P, -HX + 12, HY - 4, TH, 'highest limit'),
    })
    s += `<g transform="translate(${n1(left)} ${n1(topY)})"><ellipse cx="${n1((13 * PX) / 2)}" cy="${n1(9 * PX + 5)}" rx="36" ry="8" class="g"/>${pixelCrab(PX, { snap, look, sleep: m === 'asleep' })}`
    if (m === 'anxious' || m === 'frantic') {
      s += `<path d="M${n1(13 * PX + 4)} ${n1(PX * 2.4)}c-3.3 5 -4.2 7.2 -4.2 8.8a4.2 4.2 0 0 0 8.4 0c0 -1.6 -0.9 -3.8 -4.2 -8.8z" class="${m === 'frantic' ? 's' : 'c'}"/>`
    }
    if (m === 'frantic') {
      // a clock over his head, its hand ticking
      const cx = 13 * PX + 18, cy = -14, a = (Math.floor(f.t * 2) / 12) * Math.PI * 2
      s += `<circle cx="${n1(cx)}" cy="${cy}" r="10" class="f"/><circle cx="${n1(cx)}" cy="${cy}" r="10" class="s"/><path d="M${n1(cx)} ${cy}L${n1(cx + 6.5 * Math.sin(a))} ${n1(cy - 6.5 * Math.cos(a))}" class="o"/>`
    }
    if (m === 'panic') {
      const fl = f.still ? 1 : 1 + 0.12 * Math.sin(f.t * 14)
      s += flame(-14, 9 * PX, 1.1 * fl, 'o') + flame(13 * PX + 16, 9 * PX, 0.9 * (2 - fl), 'o')
    }
    if (m === 'asleep') {
      for (let k = 0; k < 3; k++) {
        const ph = ((f.t * 0.35 + k / 3) % 1)
        s += `<text x="${n1(13 * PX + 6 + ph * 16)}" y="${n1(PX * 2 - ph * 34)}" class="to" opacity="${n1(1 - ph)}">z</text>`
      }
    }
    return s + '</g>'
  }
  const name = $('#moodName'), desc = $('#moodDesc'), note = $('#moodNote'), range = $('#moodRange')
  stage($('#figMood'), {
    draw,
    idle: t => [0.5, 0.5 + 0.42 * Math.sin(t * 0.33 - 1.2)],
    still: 0,
    read: f => { const pct = usage(f); return `${pct}% · ${moodById(H.moodOf(pct)).name.toLowerCase()}` },
    onRead: (s, f) => {
      const pct = usage(f), m = moodById(H.moodOf(pct))
      if (name.textContent !== m.name) { name.textContent = m.name; desc.textContent = m.desc; range.textContent = m.range }
      note.textContent = H.noteOf({ pct, name: 'weekly limit', resetIn: '2d 4h' }) ?? 'No note: everything is under half.'
    },
  })

  // the five moods as the mod draws them
  $('#moodPlates').innerHTML = MOODS.map((m, i) => `
    <article class="plate" data-mood="${m.id}" style="--i:${i}">
      <div class="stage mood-stage">
        <div class="corner top"><span>Fig 2.${i + 2}</span><span>${m.range}</span></div>
        <div class="sprite"><svg viewBox="-10 -2 72 28" shape-rendering="crispEdges" role="img" aria-label="The crab, ${m.name.toLowerCase()}">${H.clawdSvg(m.id, 'idle', {}, false, true)}</svg></div>
      </div>
      <div class="foot"><div class="metric">${m.name}</div><div class="plate-title">${m.desc}</div></div>
    </article>`).join('')
  if (REDUCED) $$('#moodPlates svg').forEach(s => { try { s.pauseAnimations() } catch {} })
  const mark = () => { const m = moodNow(); $$('#moodPlates .plate').forEach(p => p.toggleAttribute('data-on', p.dataset.mood === m)) }
  on('state', mark)
  mark()
}

// ------------------------------------------------------------------ 03 levels
{
  const steps = H.LEVELS
  const N = steps.length
  const P = isoP(70, 232, 1)
  const D = 30, Wd = 70
  const hOf = i => 12 + i * 9
  const posOf = f => clamp(f.x * 1.15 - 0.075) * (N - 1)
  function draw(f) {
    const pos = posOf(f)
    const a = Math.floor(pos), b = Math.min(N - 1, a + 1)
    // he rests on a step, and hops in the middle of the way to the next
    const fr = ease3(clamp((pos - a - 0.3) / 0.4))
    const at = Math.round(pos)
    const cx = Wd / 2, cy = -(lerp(a, b, fr) + 0.5) * D
    const z = lerp(hOf(a), hOf(b), fr) + Math.sin(fr * Math.PI) * 16
    let s = ''
    for (let i = N - 1; i >= 0; i--) {
      s += box(P, { x: 0, y: -(i + 1) * D, w: Wd, dp: D, h: hOf(i), top: i === at ? 'ot' : undefined })
      s += label(P, 30, -(i + 1) * D + 9, hOf(i), `LV ${steps[i].at}`, 'floor', i === at ? 'to' : 't')
      if (steps[i].item) {
        // a flag for the step that unlocks something to wear
        const [fx, fy] = P(Wd - 8, -(i + 1) * D + 6, hOf(i))
        s += `<path d="M${n1(fx)} ${n1(fy)}L${n1(fx)} ${n1(fy - 22)}" class="${i <= at ? 'o' : 'c'}"/><path d="M${n1(fx)} ${n1(fy - 22)}l9 3.5l-9 3.5z" class="${i <= at ? 'of' : 'g'}"/>`
      }
      if (i === Math.min(a + (fr > 0.5 ? 1 : 0), N - 1)) {
        const [sx, sy] = P(cx, cy, z)
        const px = 2.9
        const [gx, gy] = P(cx, cy, hOf(i))
        s += `<ellipse cx="${n1(gx)}" cy="${n1(gy)}" rx="${n1(15 - (z - hOf(i)) * 0.3)}" ry="4" class="g"/>`
        s += `<g transform="translate(${n1(sx - 6.5 * px)} ${n1(sy - 9 * px)})">${pixelCrab(px, { snap: !f.still && fr > 0 && fr < 1 })}</g>`
      }
    }
    return s
  }
  stage($('#figLevels'), {
    draw,
    idle: t => [0.5 + 0.5 * Math.sin(t * 0.3 - 1.4), 0.5],
    still: 4.6,
    read: f => {
      const m = steps[Math.round(posOf(f))]
      return `Lv ${m.at} · ${m.title}${m.item ? ` · ${H.ITEMS[m.item].name}` : ''} · ${fmt(H.xpFor(m.at))} XP`
    },
  })

  const X = H.XP
  $('#xpTable').innerHTML = [
    ['Each turn', `+${X.turn} XP`],
    [`Each turn past ${X.turnsBeforeTired} in a day`, `+${X.tiredTurn} XP`],
    ['The first turn of the day', `+${X.daily} XP`],
    ['Each point of weekly use', `+${X.weeklyPoint} XP`],
    ['A 5-hour window that peaks at 60–99%', `+${X.paced} XP`, 1],
    ['One that peaks at 30–59%', `+${X.light} XP`],
    ['A 5-hour window reaching 100%', `+${X.maxedSession} XP`],
    ['The weekly limit reaching 100%', `+${X.maxedWeek} XP`, 1],
    ['A badge', `+${X.badge} XP`],
  ].map(([a, b, big]) => `<tr${big ? ' class="big"' : ''}><td>${a}</td><td>${b}</td></tr>`).join('')
  const coin = `<span class="coin">${COIN_SVG}</span>`
  $('#coinTable').innerHTML = [
    [`Every ${fmt(H.COINS.perTokens)} tokens Claude writes`, 1],
    ['Each level', H.COINS.level],
    ['Each badge', H.COINS.badge],
  ].map(([a, b]) => `<tr><td>${a}</td><td><span style="display:inline-flex;gap:6px;align-items:center">${coin}${b}</span></td></tr>`).join('')

  const drawStats = () => {
    const lv = H.levelOf(st.p.xp)
    $('#lvMetric').innerHTML = `This page's crab: Lv ${lv} · <span class="unit">${H.titleOf(lv)}</span>`
    const ids = Object.keys(H.BADGES)
    const earned = ids.filter(id => st.p.badges?.[id]).length
    $('#badgeCount').textContent = `${earned} of ${ids.length} earned here`
    $('#badges').innerHTML = ids.map(id => `<li${st.p.badges?.[id] ? ' data-earned' : ''}><span><b>${esc(H.BADGES[id].name)}</b><span>${esc(clean(H.BADGES[id].how))}</span></span></li>`).join('')
  }
  on('progress', drawStats)
  drawStats()
}

// ------------------------------------------------------------------ 04 shop
{
  const tabs = $('#tabs'), tiles = $('#tiles'), drawer = $('#drawer'), scrim = $('#scrim')
  let slot = 'head', open = null, opener = null
  $('#purseCoin').innerHTML = COIN_SVG
  const shelf = () => H.shelfOf(st.p)
  const priceOf = s => `<span class="coin">${COIN_SVG}</span>${fmt(s.price)}`
  const kicker = s =>
    s.state === 'wearing' ? '<span class="state-wearing">Wearing</span>'
      : s.state === 'owned' ? 'Owned'
        : s.state === 'locked' ? (s.price ? `Needs level ${s.level}` : `Free at level ${s.level}`)
          : priceOf(s)
  const tagOf = s =>
    s.state === 'wearing' ? '<span class="tag tag-on">On</span>'
      : s.state === 'owned' ? '<span class="tag">Owned</span>'
        : s.state === 'locked' ? `<span class="tag">Lv ${s.level}</span>`
          : s.state === 'short' ? '<span class="tag">Short</span>' : '<span class="tag">Buy</span>'
  const look = (s, scale) => svgFit(H.wardrobeSvg({ [s.slot]: s.id }, scale))
  const arrow = '<svg class="tile-go" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>'

  function drawTabs() {
    const all = shelf()
    tabs.innerHTML = H.SLOTS.map(sl => `<button type="button" role="tab" id="tab-${sl}" aria-selected="${sl === slot}" data-slot="${sl}">${H.SLOT_NAMES[sl]} <small>${all.filter(s => s.slot === sl).length}</small></button>`).join('')
    $$('button', tabs).forEach(b => b.addEventListener('click', () => { slot = b.dataset.slot; tiles.setAttribute('aria-labelledby', `tab-${slot}`); drawTabs(); drawTiles() }))
  }
  function drawTiles() {
    const list = shelf().filter(s => s.slot === slot)
    tiles.innerHTML = list.map(s => `
      <article class="tile" data-id="${s.id}"${open === s.id ? ' data-picked' : ''}>
        <div class="stage">
          <div class="corner top"><span>${H.SLOT_NAMES[s.slot]}</span>${tagOf(s)}</div>
          <div class="sprite">${look(s, 4)}</div>
        </div>
        <div class="tile-foot">
          <div class="min0">
            <h3 class="tile-name"><button type="button" class="tile-btn" aria-haspopup="dialog">${esc(cap(s.name))}</button></h3>
            <p class="tile-kicker">${kicker(s)}</p>
          </div>
          ${arrow}
        </div>
      </article>`).join('')
    $$('.tile', tiles).forEach(t => t.addEventListener('click', () => show(t.dataset.id, $('.tile-btn', t))))
    if (REDUCED) $$('svg', tiles).forEach(s => { try { s.pauseAnimations() } catch {} })
  }

  // a band in the drawer: the crab trying the item on, at a narrow width
  const drawerBand = { el: null, k: () => 1.25, usd: false, view: () => {
    const v = viewOf()
    const s = shelf().find(x => x.id === open)
    if (s && s.state !== 'wearing') v.outfit = { ...v.outfit, [s.slot]: s.id }
    return v
  } }
  function drawDrawer() {
    const s = shelf().find(x => x.id === open)
    if (!s) return
    const action =
      s.state === 'wearing' ? ['Take it off', false]
        : s.state === 'owned' ? ['Put it on', false]
          : s.state === 'buy' ? [`Buy for ${fmt(s.price)} coins`, false]
            : s.state === 'short' ? [`Buy for ${fmt(s.price)} coins`, true]
              : [`Reach level ${s.level}`, true]
    const why =
      s.state === 'short' ? `${fmt(s.price - st.p.coins)} more coins needed. Send a few prompts above, or press +500.`
        : s.state === 'locked' && s.price ? `On sale from level ${s.level}. The crab is level ${H.levelOf(st.p.xp)}.`
          : s.state === 'locked' ? `A level unlock: it arrives free at level ${s.level}.`
            : s.slot === 'scene' ? 'Backdrops sit behind the band at half strength, so the figures stay easy to read.' : ''
    const status = s.state === 'wearing' ? 'Wearing' : s.state === 'owned' ? 'Owned' : s.state === 'locked' ? `Level ${s.level}` : `${fmt(s.price)} coins`
    drawer.innerHTML = `
      <div class="drawer-in">
        <div class="drawer-head">
          <div><h3>${esc(cap(s.name))}</h3><p>${H.SLOT_NAMES[s.slot]} · ${status}</p></div>
          <button type="button" class="close" id="drawerClose" aria-label="Close"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </div>
        <div class="stage"><div class="sprite">${look(s, 6)}</div><div class="corner bottom"><span>Trying it on</span><span class="readout">${esc(s.id)}</span></div></div>
        <div class="drawer-band"><div class="band" id="drawerBand" role="img" aria-label="The band with the crab wearing it"></div></div>
        ${why ? `<p class="drawer-copy">${why}</p>` : ''}
        <div class="drawer-actions">
          <button type="button" class="btn btn-primary btn-sm" id="drawerAct"${action[1] ? ' disabled' : ''}>${action[0]}</button>
          <small>You have ${fmt(st.p.coins)} coins</small>
        </div>
      </div>`
    $('#drawerClose').addEventListener('click', hide)
    $('#drawerAct').addEventListener('click', () => {
      const press = H.pressOf(s)
      if (!press) return
      apply(press(st.p, s.id))
    })
    drawerBand.el = $('#drawerBand')
    requestAnimationFrame(() => drawBand(drawerBand, true))
  }
  function show(id, btn) {
    if (open === id) return hide()
    open = id
    opener = btn
    drawDrawer()
    drawer.setAttribute('data-open', '')
    scrim.setAttribute('data-open', '')
    drawer.setAttribute('aria-label', cap(H.ITEMS[id].name))
    $$('.tile', tiles).forEach(t => t.toggleAttribute('data-picked', t.dataset.id === id))
    $('#drawerClose')?.focus({ preventScroll: true })
  }
  function hide() {
    open = null
    drawer.removeAttribute('data-open')
    scrim.removeAttribute('data-open')
    $$('.tile', tiles).forEach(t => t.removeAttribute('data-picked'))
    opener?.focus({ preventScroll: true })
  }
  scrim.addEventListener('click', hide)
  addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide() })

  const purse = () => {
    $('#purseCoins').textContent = fmt(st.p.coins)
    $('#purseLevel').textContent = `Lv ${H.levelOf(st.p.xp)}`
  }
  on('progress', () => { purse(); drawTabs(); drawTiles(); if (open) drawDrawer() })
  $('#earnBtn').addEventListener('click', () => {
    st.p = { ...st.p, coins: st.p.coins + 500 }
    st.gain = { xp: 0, coins: 500, fromFrac: H.fracOf(st.p.xp) }
    clearTimeout(gainTimer)
    gainTimer = setTimeout(() => { st.gain = null; emit() }, H.GAIN_MS + 200)
    save(); emit(true); fire('progress')
  })
  $('#earnBtn').setAttribute('aria-label', 'Add 500 coins to this page\'s crab')
  purse(); drawTabs(); drawTiles()
}

// ------------------------------------------------------------------ 05 under the hood: shared readings
{
  const P = isoP(200, 142, 1.08)
  const S = [{ id: 'A', path: '~/api' }, { id: 'B', path: '~/web' }, { id: 'C', path: '~/notes' }]
  const at = k => [62 + (k - 1) * 72, 62 - (k - 1) * 72]
  const CYC = 3.4
  const valOf = c => 30 + ((c * 7) % 62)
  let forced = null
  const hearerOf = (f, cyc) => (forced ?? (f.over ? Math.round(clamp(f.x * 1.2 - 0.1) * 2) : cyc % 3))
  const along = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
  function draw(f) {
    const cyc = Math.floor(f.t / CYC), ph = (f.t % CYC) / CYC
    const who = hearerOf(f, cyc)
    const now = valOf(cyc), was = valOf(cyc - 1)
    const store = P(-48, -48, 30), storeBase = P(-48, -48, 0)
    let s = can(P, { x: -48, y: -48, r: 28, h: 30 })
    s += label(P, -66, -30, 30, 'store', 'floor', 't')
    // dashed links from each session to the store
    S.forEach((_, k) => { const [x, y] = at(k); s += `<path d="${dP([P(x, y, 10), storeBase], false)}" class="${k === who && ph < 0.3 ? 'od' : 'd'}"/>` })
    S.forEach((sess, k) => {
      const [x, y] = at(k)
      const shows = k === who || ph >= 0.6 ? now : was
      const lit = Math.round(shows / 10)
      const hot = k === who && ph < 0.6
      s += box(P, {
        x: x - 32, y: y - 32, w: 64, dp: 66, h: 10, tone: hot ? 'o' : undefined,
        inner: Array.from({ length: 10 }, (_, i) => `<path d="${quad(P, x - 2 + i * 3.2, y - 8, 2.4, 22, 10)}" class="${i < lit ? (shows >= 80 ? 'of' : 'ot') : 'c'}"/>`).join('') +
          label(P, x - 27, y - 18, 10, `${sess.id} ${sess.path}`, 'floor', hot ? 'to' : 't') +
          label(P, x - 27, y + 28, 10, `5h ${shows}%`, 'floor', hot ? 'to' : 'tq'),
      })
    })
    // the packet: up to the store, then out to the other two
    const src = P(...at(who), 10)
    if (ph < 0.3) {
      const [px, py] = along(src, store, ease3(ph / 0.3))
      s += `<circle cx="${n1(px)}" cy="${n1(py)}" r="4" class="of"/>`
    } else if (ph < 0.6) {
      S.forEach((_, k) => {
        if (k === who) return
        const [px, py] = along(store, P(...at(k), 10), ease3((ph - 0.3) / 0.3))
        s += `<circle cx="${n1(px)}" cy="${n1(py)}" r="3.4" class="of"/>`
      })
    }
    return s
  }
  stage($('#figSync'), {
    draw,
    idle: t => [0.5, 0.5],
    still: CYC * 0.7,
    read: f => {
      const cyc = Math.floor(f.t / CYC), ph = (f.t % CYC) / CYC
      const who = S[hearerOf(f, cyc)].id
      return ph < 0.6 ? `${who} heard 5h ${valOf(cyc)}%` : `all three show ${valOf(cyc)}%`
    },
  })
}

// ------------------------------------------------------------------ 05 under the hood: updates
{
  const P = isoP(98, 126, 1.05)
  const STEP = 44
  const commits = [0, 1, 2, 3, 4, 5]
  const TAGS = { 1: 'v0.9.0', 3: 'v1.0.0', 5: 'v1.1.0' }
  const CYC = 7
  const phaseOf = f => (f.over ? clamp(f.x * 1.2 - 0.1) : (f.t % CYC) / CYC)
  function draw(f) {
    const ph = phaseOf(f)
    const fresh = ph >= 0.22 // the new commits and their tag are on GitHub
    const head = ph < 0.6 ? 3 : ph < 0.8 ? lerp(3, 5, ease3((ph - 0.6) / 0.2)) : 5
    let s = `<path d="${dP([P(0, 0, 0), P(STEP * 3, 0, 0)], false)}" class="c"/><path d="${dP([P(STEP * 3, 0, 0), P(STEP * 5, 0, 0)], false)}" class="${fresh ? 'c' : 'd'}"/>`
    for (const i of commits) {
      const ghost = i > 3 && !fresh
      if (ghost) { const [cx, cy] = P(i * STEP, 0, 4); s += `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(8 * 1.2247 * P.k)}" ry="${n1(8 * 0.7071 * P.k)}" class="d"/>`; continue }
      s += can(P, { x: i * STEP, y: 0, r: 8, h: 4, tone: i === 5 && ph >= 0.22 && ph < 0.6 ? 'o' : undefined })
      if (TAGS[i] && !(i === 5 && !fresh)) {
        const rise = i === 5 ? ease3((ph - 0.22) / 0.12) : 1
        const [fx, fy] = P(i * STEP, 0, 4)
        const top = fy - 44 * rise
        s += `<path d="M${n1(fx)} ${n1(fy)}L${n1(fx)} ${n1(top)}" class="${i === 5 ? 'o' : 's'}"/><path d="M${n1(fx)} ${n1(top)}l10 4l-10 4z" class="${i === 5 ? 'of' : 'k'}"/>`
        s += `<text x="${n1(fx + 14)}" y="${n1(top + 8)}" class="${i === 5 ? 'to' : 't'}">${TAGS[i]}</text>`
      }
    }
    // the update arc: from your clone to the new tag
    if (ph >= 0.42 && ph < 0.8) {
      const a = P(3 * STEP, 30, 22), b = P(5 * STEP, 30, 22)
      const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 30]
      s += `<path d="M${n1(a[0])} ${n1(a[1])}Q${n1(mid[0])} ${n1(mid[1])} ${n1(b[0])} ${n1(b[1])}" class="od"/>`
    }
    // your clone: a box riding beside the commit it's on
    s += box(P, { x: head * STEP - 10, y: 22, w: 20, dp: 16, h: 14, tone: 'o', top: 'ot' })
    s += label(P, head * STEP - 10, 46, 0, 'your clone', 'floor', 'to')
    return s
  }
  stage($('#figUpdate'), {
    draw,
    idle: t => [0.5, 0.5],
    still: CYC * 0.9,
    read: f => {
      const ph = phaseOf(f)
      return ph < 0.22 ? 'your clone · v1.0.0'
        : ph < 0.42 ? 'v1.1.0 tagged on GitHub'
          : ph < 0.6 ? 'band offers: Update to v1.1.0'
            : ph < 0.8 ? 'git merge --ff-only v1.1.0'
              : 'your clone · v1.1.0 · reloaded'
    },
  })
}

// ------------------------------------------------------------------ 06 reel
{
  const box = $('#reelBox'), video = $('#reelVideo'), play = $('#reelPlay')
  play.addEventListener('click', () => {
    video.controls = true
    box.setAttribute('data-playing', '')
    video.play().catch(() => {})
  })
}

// ------------------------------------------------------------------ 07 install: the rail reaches to the step in view
{
  const rail = $('#rail'), steps = $$('.step', rail)
  const pick = () => {
    const line = innerHeight * 0.6
    let n = 0
    steps.forEach((s, i) => { const on = s.getBoundingClientRect().top < line; s.toggleAttribute('data-on', on); if (on) n = i + 1 })
    const last = steps[n - 1]
    rail.style.setProperty('--reach', n ? String(clamp((last.offsetTop + 26) / rail.offsetHeight)) : '0')
  }
  addEventListener('scroll', pick, { passive: true })
  addEventListener('resize', pick)
  pick()
}

syncSliders()
emit(true)
