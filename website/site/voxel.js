// The crab in three dimensions. site.js reads the mod's pixel art back into rects with their SMIL;
// this file extrudes them into voxels: a rounded body, the face and outfit as relief on it, the
// props as floating cubes. In the hero he stands on his stage, then rides the scroll down into the
// band and flattens into the very sprite he was built from. In the shop he stands on a turntable,
// inside a diorama built the same way from the backdrops' pixel layers.
const S = window.SITE
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js'

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const inv = (a, b, v) => clamp((v - a) / (b - a))
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt))
const ease = {
  out: t => 1 - Math.pow(1 - t, 3),
  io: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) },
}
const TAU = Math.PI * 2

const PIV = { x: 21, y: 14 } // the middle of his body, in the band's units (his sprite's group sits at 8,5)
const SOLE = 9               // his soles, below PIV
const GAP = .9               // a voxel fills this much of its cell across; the rest is the groove between voxels
const ZGAP = .97             // and this much front to back, so a stack reads as one rounded piece

if (S) boot().catch(e => {
  console.warn('The 3D crab is off:', e?.message || e)
  try { S.landed(true) } catch {}
})

async function boot() {
  const THREE = await import(THREE_URL)
  const kit = makeKit(THREE)
  const ticks = []
  if (!S.REDUCED) { const t = hero(kit); if (t) ticks.push(t) }
  const t = fitting(kit)
  if (t) ticks.push(t)
  if (!ticks.length) return
  let last = performance.now() / 1000
  const loop = ms => {
    requestAnimationFrame(loop)
    const now = ms / 1000, dt = Math.min(.05, Math.max(.001, now - last))
    last = now
    if (document.hidden) return
    for (const f of ticks) {
      try { f(now, dt) } catch (e) { console.error(e); ticks.splice(ticks.indexOf(f), 1) }
    }
  }
  requestAnimationFrame(loop)
}

function makeKit(THREE) {
  THREE.ColorManagement.enabled = false // the mod's hex colours reach the screen exactly as written
  const H = S.H
  const geo = new THREE.BoxGeometry(1, 1, 1)
  // Lit in sRGB on purpose: the colours stay the mod's own, and at uFlat = 1 they are exact.
  const vertexShader = /* glsl */ `
    varying vec3 vCol; varying vec3 vN; varying vec3 vP; varying vec3 vS; varying vec3 vLN;
    void main() {
      vCol = instanceColor;
      vP = position;
      vLN = normal;
      vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vN = normalize(normalMatrix * normalize(mat3(instanceMatrix) * normal));
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`
  const fragmentShader = /* glsl */ `
    uniform float uFlat; uniform vec3 uKey; uniform vec3 uFill; uniform float uBevel; uniform float uEdge;
    varying vec3 vCol; varying vec3 vN; varying vec3 vP; varying vec3 vS; varying vec3 vLN;
    void main() {
      vec3 n = normalize(vN);
      float shade = .64 + .48 * max(dot(n, uKey), 0.) + .1 * max(dot(n, uFill), 0.) + .04 * n.y;
      // a bevel: each face darkens a little toward its edges, so the voxels read as cubes
      vec3 an = abs(vLN);
      vec3 d = (.5 - abs(vP)) * vS;
      float e = 1e4;
      if (an.x < .5) e = min(e, d.x);
      if (an.y < .5) e = min(e, d.y);
      if (an.z < .5) e = min(e, d.z);
      shade *= 1. - uEdge * (1. - smoothstep(0., uBevel, e));
      gl_FragColor = vec4(mix(vCol * shade, vCol, uFlat), 1.);
    }`
  const material = () => new THREE.ShaderMaterial({
    uniforms: {
      uFlat: { value: 0 },
      uKey: { value: new THREE.Vector3(-.42, .74, .56).normalize() },
      uFill: { value: new THREE.Vector3(.72, -.12, .45).normalize() },
      uBevel: { value: .34 },
      uEdge: { value: .22 },
    },
    vertexShader,
    fragmentShader,
  })

  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
  const Q0 = new THREE.Quaternion()

  class Voxels {
    constructor(cap) {
      this.cap = cap
      this.mesh = new THREE.InstancedMesh(geo, material(), cap)
      this.mesh.frustumCulled = false
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.mesh.setColorAt(0, new THREE.Color())
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      this.mesh.count = 0
      this.cubes = []
    }
    get u() { return this.mesh.material.uniforms }
    alive() { return this.cubes.filter(c => c.died === undefined).length }
    // A new model: voxels in both stay (recolouring if they must), new ones pop in, gone ones shrink away.
    set(list, now, { instant = false, delay = () => 0, dur = .42, out = .24 } = {}) {
      const old = new Map()
      for (const c of this.cubes) if (c.died === undefined) old.set(c.key, c)
      const next = []
      for (const c of list) {
        const o = old.get(c.key)
        if (o) {
          old.delete(c.key)
          const color = o.color
          const recolour = !color.equals(c.color)
          const to = c.color
          Object.assign(o, c, { color, born: o.born, delay: o.delay, dur: o.dur })
          if (recolour) { o.from = color.clone(); o.to = to; o.cAt = now + (instant ? -1 : delay(o)) }
          next.push(o)
        } else {
          if (!instant) { c.born = now; c.delay = delay(c); c.dur = dur }
          next.push(c)
        }
      }
      for (const o of old.values()) {
        if (instant) continue
        o.died = now
        o.delay = delay(o) * .5
        o.dur = out
        next.push(o)
      }
      this.cubes = next
    }
    // Write every live voxel's matrix and colour; `place` puts it in _p/_s (and _q), or says it's hidden.
    flush(now, place) {
      let i = 0
      const keep = []
      const mesh = this.mesh
      for (const c of this.cubes) {
        let life = 1
        if (c.died !== undefined) {
          const u = clamp((now - c.died - c.delay) / c.dur)
          if (u >= 1) continue
          life = 1 - ease.io(u)
        } else if (c.born !== undefined) {
          const u = clamp((now - c.born - c.delay) / c.dur)
          if (u >= 1) c.born = undefined
          else life = ease.back(u)
        }
        keep.push(c)
        if (c.to) {
          const u = clamp((now - c.cAt) / .34)
          c.color.copy(c.from).lerp(c.to, ease.io(u))
          if (u >= 1) { c.color.copy(c.to); c.to = null }
        }
        if (i >= this.cap || life < .002) continue
        _q.copy(Q0)
        if (!place(c, _p, _s, _q)) continue
        _s.multiplyScalar(life)
        _m.compose(_p, _q, _s)
        mesh.setMatrixAt(i, _m)
        mesh.setColorAt(i, c.color)
        i++
      }
      this.cubes = keep
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
    }
  }

  // ---------------------------------------------------------------- the crab, as voxels
  const bodyOf = (mood, outfit) => String((outfit.shell && H.SHELLS[outfit.shell]) || (mood === 'asleep' ? H.COLORS.sleepy : H.CLAWD)).toLowerCase()
  const isCore = (col, row) => col >= 2 && col <= 10 && row >= 0 && row <= 6
  // How many voxels deep each body cell is: the 9 x 7 body is a flat-fronted block with its rim
  // stepped in, the arms are three deep and the legs two.
  const stackOf = (col, row) => (isCore(col, row) ? (Math.min(col - 2, 10 - col, row, 6 - row) === 0 ? 5 : 7) : row >= 7 ? 2 : 3)
  const rkey = (b, r) => `${Math.round(b.x * 100)},${Math.round(b.y * 100)},${r.w},${r.h},${r.fill.toLowerCase()}`

  function crabCubes(mood, outfit, { burst = false, props = true } = {}) {
    const frag = H.clawdSvg(mood, 'idle', outfit, burst, props)
    const rects = S.parseSprite(frag)
    const base = rects.map(r => S.rectAt(r, 0))
    // What he wears on his back is behind him: find it by drawing him without it.
    const back = new Set()
    if (outfit.back && outfit.back !== 'none') {
      const without = new Map()
      for (const r of S.parseSprite(H.clawdSvg(mood, 'idle', { ...outfit, back: undefined }, burst, props))) {
        const k = rkey(S.rectAt(r, 0), r)
        without.set(k, (without.get(k) || 0) + 1)
      }
      const seen = new Map()
      rects.forEach((r, i) => {
        const k = rkey(base[i], r), n = (seen.get(k) || 0) + 1
        seen.set(k, n)
        if (n > (without.get(k) || 0)) back.add(r)
      })
    }
    const body = bodyOf(mood, outfit)
    const cellOf = (b, r) => {
      if (Math.abs(r.w - 2) > .01 || Math.abs(r.h - 2) > .01) return null
      const c = (b.x - 8) / 2, w = (b.y - 5) / 2
      return Math.abs(c - Math.round(c)) < .01 && Math.abs(w - Math.round(w)) < .01 ? [Math.round(c), Math.round(w)] : null
    }
    const info = rects.map((r, i) => ({ r, b: base[i], cell: cellOf(base[i], r), fill: r.fill.toLowerCase(), order: i }))
    const cells = new Map()
    for (const it of info) if (it.cell && it.fill === body) cells.set(it.cell.join(), stackOf(...it.cell))
    const out = [], dup = new Map()
    const push = (it, kind, k, n) => {
      let key = `${kind}:${Math.round(it.b.x * 100)},${Math.round(it.b.y * 100)},${it.r.w},${k}`
      const d = (dup.get(key) || 0) + 1
      dup.set(key, d)
      if (d > 1) key += `#${d}`
      out.push({
        key, r: it.r, kind, k, n, w: it.r.w, h: it.r.h, order: it.order,
        cx: it.b.x + it.r.w / 2 - PIV.x, cy: PIV.y - (it.b.y + it.r.h / 2),
        color: new THREE.Color(it.r.fill),
      })
    }
    for (const it of info) {
      if (back.has(it.r)) { push(it, 'back', 0, 1); continue }
      if (it.cell) {
        const n = cells.get(it.cell.join())
        if (it.fill === body) { for (let k = 0; k < n; k++) push(it, 'body', k, n); continue }
        // Over the body: relief on its front, or wrapped right round it where the body is thin.
        if (n !== undefined) { push(it, n <= 3 ? 'wrap' : 'decal', 0, n); continue }
        // Hats and the headphone band sit on his head, about as deep as it; anything else, a little less.
        const n2 = it.cell[1] <= 0 ? 5 : 3
        for (let k = 0; k < n2; k++) push(it, 'free', k, n2)
        continue
      }
      push(it, 'prop', 0, 1)
    }
    return out
  }

  // Where one of his voxels goes, given its rect's place at this moment (p) and how 3D he is (a:
  // 0 is the flat sprite, 1 full voxels; the intro overshoots a little).
  function crabPlace(c, p, a, P, Sc) {
    if (p.vis < .5) return false
    const a1 = clamp(a)
    const g = lerp(1, GAP, a1), gz = lerp(1, ZGAP, a1)
    const dk = Math.max(.015, a)
    const bump = c.order * .0015
    let z = 0, sx = c.w * g, sy = c.h * g, sz
    switch (c.kind) {
      case 'body': case 'free': z = (c.k - (c.n - 1) / 2) * 2 * dk; sz = 2 * gz * dk; break
      case 'decal': { const t = .55 * a1 + .03; z = (c.n - 1 + gz) * dk + t / 2 + .012 + bump; sz = t; break }
      case 'wrap': { const e = .18 * a1 + .012 + bump; sx += e; sy += e; sz = (c.n - 1 + gz) * 2 * dk + 2 * e; z = .01 + bump; break }
      case 'back': z = -5 * dk - .03; sz = 2 * gz * dk; break
      default: sz = Math.max(c.w, c.h) * gz * dk
    }
    P.set(p.x + c.w / 2 - PIV.x, PIV.y - (p.y + c.h / 2), z)
    Sc.set(sx, sy, sz)
    return true
  }

  // ---------------------------------------------------------------- the fitting room's set
  // No backdrop: a small plinth. A backdrop: a floating island built from its own pixel layers.
  // The ground is the top, the strip (hedge, sea, skyline) runs along the back edge, the ground
  // marks are set into the top, the landmarks stand on an arc behind him, the sun or moon hangs
  // behind, and stars or fireflies drift around it.
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t)
  const cellsOf = (l, f) => l.grid.forEach((row, gy) => { for (let gx = 0; gx < row.length; gx++) if (l.colors[row[gx]]) f(gx, gy, row[gx]) })
  const hash = (a, b = 0) => {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 7919, 668265263)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const jitter = (c, r, k = .07) => mix(c, r < .5 ? '#000000' : '#ffffff', Math.abs(r - .5) * 2 * k)
  const TILE = 4, NX = 17, NZ = 11, FRONT = 10, DEPTH = 4
  const ISLAND_X = NX * TILE / 2
  const tileX = i => (i - (NX - 1) / 2) * TILE
  const tileZ = j => FRONT - TILE / 2 - j * TILE
  // a rounded slab, narrower on each layer down
  const onIsland = (i, j, k = 0) => {
    const t = 1 - k * .21
    const hx = (NX - 1) / 2 * t, hz = (NZ - 1) / 2 * (t - k * .02)
    if (hx < 0 || hz < 0) return false
    const u = Math.abs(i - (NX - 1) / 2) / Math.max(hx, .01), v = Math.abs(j - (NZ - 1) / 2) / Math.max(hz, .01)
    return u ** 6 + v ** 6 <= 1.1
  }
  // A sprite whose rows are each one unbroken, centred run (a pine, the sun, a planet) is turned on
  // a lathe, so it's round from every side; anything else is a slab two voxels deep.
  const isRound = l => l.grid.every(row => {
    const t = row.replace(/\.+$/, '')
    const a = row.search(/[^.]/)
    if (a < 0) return true
    const b = t.length - 1
    return !/\./.test(row.slice(a, b + 1)) && Math.abs(a + b - (Math.max(...l.grid.map(r => r.length)) - 1)) <= 0
  })

  function setCubes(id) {
    const out = []
    const add = (key, x, y, z, w, h, d, color, g = .92, extra) => out.push(Object.assign({ key, x, y, z, w, h, d, g, color: color.isColor ? color : new THREE.Color(color) }, extra))
    const s = id && H.SCENES[id]
    if (!s) {
      // a plinth of chunky tiles, stepping in underneath
      const R = 6.3
      for (let k = 0; k < 3; k++) {
        const r0 = R - k * 1.6
        for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) {
          const r = Math.hypot(i, j)
          if (r > r0) continue
          const top = k === 0
          const c = top ? (r > R - 1 ? '#272a31' : (i + j) & 1 ? '#2e3139' : '#33363f') : jitter(k === 1 ? '#22252b' : '#1d1f24', hash(i * 13 + k, j))
          add(`p${k}:${i},${j}`, i * 3, -SOLE - 1.5 - k * 3, j * 3, 3, 3, 3, c, .94)
        }
      }
      return out
    }

    // the island: a top of ground tiles over three layers of rock
    const marks = new Map()
    const ground = s.ground
    const backRow = i => { for (let j = NZ - 1; j >= 0; j--) if (onIsland(i, j)) return j; return -1 }
    const layers = s.layers.map(l => {
      const p = l.p ?? H.SCENE_P
      const rows = l.grid.length, cols = Math.max(...l.grid.map(r => r.length))
      const up = l.up ?? 0
      const kind = l.repeat && rows === 1 && up < 0 ? 'marks'
        : p < H.SCENE_P ? (rows * cols > 100 ? 'stars' : 'motes')
          : l.repeat ? 'strip'
            : up > 4 ? 'sky' : 'landmark'
      return { l, p, rows, cols, up, kind }
    })
    // the sea floods the back rows; a two-row strip whose lower row is solid is water
    const sea = layers.find(L => L.kind === 'strip' && L.rows === 2 && !/\./.test(L.l.grid[1]))
    // ground marks (ripples, craters) are set into the top, clear of where he stands
    for (const L of layers.filter(L => L.kind === 'marks')) {
      cellsOf(L.l, (gx, gy, ch) => {
        const i = Math.round(gx / (L.cols - 1) * (NX - 3)) + 1
        let j = (gx * 7) % 3
        if (Math.abs(tileX(i)) < 14 && j > 0) j = 0
        if (onIsland(i, j)) marks.set(`${i},${j}`, L.l.colors[ch])
      })
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      if (!onIsland(i, j)) continue
      const r = hash(i, j)
      const wet = sea && j >= backRow(i) - 1
      const mark = marks.get(`${i},${j}`)
      const top = wet ? jitter(sea.l.colors['#'] || Object.values(sea.l.colors)[0], r, .05)
        : mark ? new THREE.Color(mark)
          : jitter((i + j) & 1 ? ground : mix(ground, '#000000', .06), r, .06)
      add(`g${i},${j}`, tileX(i), -SOLE - 1.5 - (wet ? .7 : mark ? .35 : 0), tileZ(j), TILE, 3, TILE, top, .985)
      for (let k = 1; k <= DEPTH; k++) {
        if (!onIsland(i, j, k + (hash(i + 31 * k, j) < .35 ? .4 : 0))) break
        add(`u${k}:${i},${j}`, tileX(i), -SOLE - 3 - 3.5 * (k - .5), tileZ(j), TILE, 3.5, TILE, jitter(mix(ground, '#000000', .3 + .09 * k), hash(i * 5 + k, j * 3), .05), .97)
      }
    }

    let li = 0
    for (const L of layers) {
      const { l, p, rows, cols, up, kind } = L
      li++
      if (kind === 'marks') continue
      // where the layer sits on the band, measured from his middle
      const x0 = l.right === undefined ? -2 + (l.left ?? 0) * H.SCENE_P : -2 + 44 - l.right * H.SCENE_P - cols * p
      const cx = x0 + cols * p / 2 - PIV.x
      if (kind === 'strip') {
        if (L === sea) {
          // wave caps riding on the water, in two staggered rows
          cellsOf(l, (gx, gy, ch) => {
            if (gy !== 0) return
            for (const [row, off] of [[1, 0], [0, 13]]) {
              const X = -ISLAND_X + ((gx + off) % cols) * p + p / 2
              const i = Math.round(X / TILE + (NX - 1) / 2), j = backRow(i) - row
              if (j < 0 || !onIsland(i, j)) continue
              add(`w${li}:${gx},${row}`, X, -SOLE - .7 + .35, tileZ(j) + (row ? 1.2 : -.6), p, .7, p * .8, l.colors[ch], .95, { bob: gx * .9 + row * 2.1, bs: 1.3, ba: .22 })
            }
          })
          continue
        }
        // a hedge or a skyline: stands along the back edge, two voxels deep
        cellsOf(l, (gx, gy, ch) => {
          const X = -ISLAND_X + gx * p + p / 2
          const i = Math.round((X - p / 2) / TILE + (NX - 1) / 2 + .01)
          const j = backRow(clamp(i, 0, NX - 1))
          if (j < 0) return
          for (let k = 0; k < 2; k++) {
            add(`s${li}:${gx},${gy},${k}`, X, -SOLE + (rows - 1 - gy) * p + p / 2, tileZ(j) - TILE / 2 + p / 2 + k * p, p, p, p, l.colors[ch], .9)
          }
        })
        continue
      }
      if (kind === 'stars' || kind === 'motes') {
        cellsOf(l, (gx, gy, ch) => {
          const r1 = hash(li * 101 + gx, gy), r2 = hash(gy * 17 + li, gx * 3)
          if (kind === 'stars') {
            // a dome of stars behind the island
            const th = ((x0 + gx * p) / 52 - .5) * 2.3 + (r1 - .5) * .2
            const R = 44 + r2 * 8
            add(`t${li}:${gx},${gy}`, Math.sin(th) * R, 6 + (1 - gy / rows) * 20 + up + r1 * 4, -Math.cos(th) * R * .6 - 20, 1.2, 1.2, 1.2, l.colors[ch], 1, { tw: r1 * TAU, ts: .8 + r2 * 1.4 })
          } else {
            // fireflies drift about the island, three for each one in the art
            for (let q = 0; q < 3; q++) {
              const a = hash(li * 7 + gx * 3 + q, gy * 5 + q), b = hash(gy * 11 + q, gx * 13 + li)
              const X = (a - .5) * (ISLAND_X * 2 - 6), Z = -28 + b * 34
              if (Math.abs(X) < 16 && Z > -12) continue      // not in his face
              add(`m${li}:${gx},${gy},${q}`, X, 2 + (rows - gy) * 2.5 + a * 9, Z, p * .8, p * .8, p * .8, l.colors[ch], 1, { bob: r1 * TAU + q, bs: .6 + r2 * .5, ba: 1.6, tw: b * TAU, ts: 1.4 + a })
            }
          }
        })
        continue
      }
      const round = isRound(l)
      const mid = (cols - 1) / 2
      if (kind === 'sky') {
        // the sun, moon or planet: high up behind
        const X = clamp(cx * 1.5, -ISLAND_X + cols * p / 2, ISLAND_X - cols * p / 2)
        const Y0 = 22 + (up - 5) * 2.5
        cellsOf(l, (gx, gy, ch) => {
          const Y = Y0 + (rows / 2 - gy - .5) * p
          if (round) lathe(`k${li}`, l, gx, gy, ch, mid, X, Y, -30, p)
          else add(`k${li}:${gx},${gy}`, X + (gx - mid) * p, Y, -30, p, p, p, l.colors[ch], .92)
        })
        continue
      }
      // a landmark: on an arc behind him, pushed out past his sides, kept on the island
      const a = Math.sign(cx || 1) * (.55 + Math.min(1, Math.abs(cx) / 23) * .75)
      const half = cols * p / 2
      const X = clamp(Math.sin(a) * 27, -ISLAND_X + half + 1.5, ISLAND_X - half - 1.5)
      const Z = -Math.cos(a) * 20 - 4
      cellsOf(l, (gx, gy, ch) => {
        const Y = -SOLE + (rows - 1 - gy) * p + p / 2
        if (round) lathe(`l${li}`, l, gx, gy, ch, mid, X, Y, Z, p)
        else for (let k = 0; k < 2; k++) add(`l${li}:${gx},${gy},${k}`, X + (gx - mid) * p, Y, Z + (k - .5) * p, p, p, p, l.colors[ch], .92)
      })
    }
    return out

    // one row of a round sprite, as a disc of voxels
    function lathe(key, l, gx, gy, ch, mid, X, Y, Z, p) {
      if (gx > mid + .01) return
      const r = mid - gx + .5                  // this cell's ring
      const span = Math.ceil(r)
      for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
        const d = Math.hypot(dx + (mid % 1), dz + (mid % 1))
        if (d > r || d <= r - 1) continue      // only this cell's ring; the inner cells draw the rest
        add(`${key}:${gy},${dx},${dz}`, X + (dx + (mid % 1)) * p, Y, Z + (dz + (mid % 1)) * p, p, p, p, l.colors[ch], .92)
      }
    }
  }
  const setPlace = (c, P, Sc, now) => {
    P.set(c.x, c.y, c.z)
    let s = c.g
    if (c.bob !== undefined) P.y += Math.sin(now * c.bs + c.bob) * c.ba
    if (c.tw !== undefined) s *= .7 + .3 * Math.sin(now * c.ts + c.tw)
    Sc.set(c.w * s, c.h * s, c.d * s)
    return true
  }

  // A soft round shadow on the ground.
  function shadow() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: .4 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; void main() { float r = length(vUv - .5) * 2.; float a = 1. - smoothstep(.1, 1., r); gl_FragColor = vec4(0., 0., 0., a * a * uA); }',
      transparent: true,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.renderOrder = -1
    return { mesh, mat }
  }

  return { THREE, H, Voxels, crabCubes, crabPlace, setCubes, setPlace, shadow, _e, _q }
}

// A hop: crouch, spring up (with a turn every few), land and settle.
const NO_HOP = { y: 0, sx: 1, sy: 1, spin: 0 }
function hopOf(u, flip, height = 10, D = .62) {
  if (u < 0 || u >= D) return NO_HOP
  const k = u / D
  if (k < .14) { const q = ease.out(k / .14); return { y: 0, sx: 1 + .1 * q, sy: 1 - .16 * q, spin: 0 } }
  if (k < .8) {
    const v = (k - .14) / .66, rise = Math.max(0, 1 - v * 2.4)
    return { y: 4 * v * (1 - v) * height, sx: 1 - .07 * rise, sy: 1 + .12 * rise, spin: flip ? TAU * ease.io(v) : 0 }
  }
  const q = Math.sin(Math.PI * (k - .8) / .2)
  return { y: 0, sx: 1 + .08 * q, sy: 1 - .12 * q, spin: flip ? TAU : 0 }
}

function renderer(THREE, canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  r.setClearColor(0x000000, 0)
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1))
  return r
}

// ------------------------------------------------------------------ the hero: stage, then the band
function hero(kit) {
  const { THREE } = kit
  const heroEl = document.getElementById('hero'), cv = document.getElementById('gl')
  const fallbackEl = document.getElementById('heroFallback'), bandEl = document.getElementById('heroBand')
  if (!heroEl || !cv || !fallbackEl || !bandEl) return null
  let gl
  try { gl = renderer(THREE, cv) } catch (e) { console.warn('No WebGL for the hero crab:', e?.message || e); return null }
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000)
  const model = new THREE.Group()
  const crab = new kit.Voxels(2400)
  const shade = kit.shadow()
  model.add(shade.mesh, crab.mesh)
  const sparks = new kit.Voxels(360)
  sparks.u.uFlat.value = .25
  scene.add(model, sparks.mesh)

  // The canvas covers the hero; at z = 0 one world unit is one CSS pixel.
  let W = 1, Hh = 1
  const size = () => {
    W = Math.max(1, cv.clientWidth); Hh = Math.max(1, cv.clientHeight)
    gl.setSize(W, Hh, false)
    const D = (Hh / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    camera.aspect = W / Hh
    camera.position.set(0, 0, D)
    camera.near = Math.max(1, D - 1200)
    camera.far = D + 1200
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(size).observe(cv)
  size()
  let near = true
  new IntersectionObserver(es => { near = es[0].isIntersecting }, { rootMargin: '15% 0px' }).observe(heroEl)
  let dead = false
  cv.addEventListener('webglcontextlost', e => {
    e.preventDefault()
    dead = true
    cv.classList.add('off')
    heroEl.classList.remove('gl-on', 'flown')
    S.landed(true)
  })

  // The model follows the page's state: his mood, his outfit, a level-up's sparkles.
  let key = '', dirty = true
  const clock = () => performance.now() / 1000
  function rebuild(now, first) {
    const mood = S.mood(), outfit = S.outfit(), burst = !!S.st.burst
    const k = mood + JSON.stringify(outfit) + burst
    if (k === key) return
    key = k
    const list = kit.crabCubes(mood, outfit, { burst })
    for (const c of list) c.wd = Math.hypot(c.cx, c.cy) * .022
    crab.set(list, now, first ? { instant: true } : { delay: c => (c.wd ?? 0) * .5 + Math.random() * .05 })
    S.setVoxCount(crab.alive())
  }
  S.on('state', () => { dirty = true })
  S.on('progress', () => { dirty = true })

  let hopAt = -9, hops = 0, pokeAt = -9, spinAt = -9, gain = null, level = false
  S.on('hop', () => { hopAt = clock(); hops++ })
  S.on('poke', () => { pokeAt = clock() })
  S.on('gain', g => { gain = { xp: (gain?.xp ?? 0) + (g?.xp ?? 0), coins: (gain?.coins ?? 0) + (g?.coins ?? 0) } })
  S.on('level', () => { level = true; spinAt = clock() + .1 })

  let px = 0, py = 0, pAt = -9
  addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect()
    px = e.clientX - r.left; py = e.clientY - r.top; pAt = clock()
  }, { passive: true })

  // How far down into the band he is: 0 on his stage, 1 in the band. The flight starts as the band
  // comes into view and ends with it a little above the middle of the screen.
  const flightRaw = () => {
    const r = bandEl.getBoundingClientRect()
    const top = r.top + scrollY, vh = innerHeight
    const s0 = Math.max(0, top - vh * .9), s1 = Math.max(s0 + 260, top - vh * .4)
    return inv(s0, s1 - 6, scrollY)
  }
  // The screen place and scale of his middle in an SVG that draws him: the stage's 2D crab, or the band.
  const poseOf = (svg, base) => {
    const vb = svg?.viewBox?.baseVal
    if (!vb || !vb.width) return null
    const r = svg.getBoundingClientRect()
    if (!r.width || !r.height) return null
    const k = Math.min(r.width / vb.width, r.height / vb.height)
    return {
      x: r.left - base.left + (r.width - vb.width * k) / 2 + (PIV.x - vb.x) * k,
      y: r.top - base.top + (r.height - vb.height * k) / 2 + (PIV.y - vb.y) * k,
      s: k,
    }
  }
  const bandTime = now => { try { return bandEl.firstElementChild.getCurrentTime() } catch { return now } }

  // Sparks: coins and XP that pop out of him.
  const parts = []
  function spawn(n, colors, x, y, s, { up = 80, spread = 46, size = 1.5, life = 1.1 } = {}) {
    for (let i = 0; i < n && parts.length < sparks.cap; i++) {
      const a = Math.random() * TAU
      parts.push({
        x: x - W / 2 + (Math.random() - .5) * 10 * s, y: Hh / 2 - y, z: (Math.random() - .5) * 10 * s,
        vx: Math.cos(a) * spread * s * Math.random(), vy: (up + Math.random() * 40) * s, vz: Math.sin(a) * spread * s * .6,
        r: [Math.random() * 3, Math.random() * 3, 0], vr: [(Math.random() - .5) * 14, (Math.random() - .5) * 14, (Math.random() - .5) * 6],
        s: size * s * (.7 + Math.random() * .6), g: 300 * s, t: 0, life: life * (.75 + Math.random() * .5),
        color: new THREE.Color(colors[i % colors.length]),
      })
    }
  }
  function sparkTick(dt) {
    let i = 0
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]
      p.t += dt
      if (p.t >= p.life) { parts.splice(k, 1); continue }
      p.vy -= p.g * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      for (let j = 0; j < 3; j++) p.r[j] += p.vr[j] * dt
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3()
    for (const p of parts) {
      const k = 1 - ease.io(inv(p.life * .6, p.life, p.t))
      kit._e.set(p.r[0], p.r[1], p.r[2])
      q.setFromEuler(kit._e)
      m.compose(pos.set(p.x, p.y, p.z), q, sc.setScalar(p.s * k))
      sparks.mesh.setMatrixAt(i, m)
      sparks.mesh.setColorAt(i, p.color)
      i++
    }
    sparks.mesh.count = i
    sparks.mesh.instanceMatrix.needsUpdate = true
    sparks.mesh.instanceColor.needsUpdate = true
  }

  let fS = flightRaw(), landed = null, shown = false, introAt = 0, yaw = 0, pitch = 0
  function setLanded(on) {
    const was = landed
    landed = on
    cv.classList.toggle('off', on)
    heroEl.classList.toggle('flown', on)
    S.landed(on)
    if (was !== null && shown) on ? S.Sound.thud() : S.Sound.whoosh()
  }
  const posCache = new Map()

  return function tick(now, dt) {
    if (dead) return
    const fr = flightRaw()
    fS = Math.abs(fr - fS) < .002 ? fr : damp(fS, fr, 7.5, dt)
    const isLanded = fS >= .995
    if (isLanded !== landed) setLanded(isLanded)
    if (dirty) { dirty = false; rebuild(now, !shown) }
    if (landed || !near) {
      gain = null; level = false
      if (landed && !shown) { shown = true; introAt = now - 10; S.glOn('hero') }
      return
    }
    if (!introAt) introAt = now
    const T = now - introAt
    const base = cv.getBoundingClientRect()
    const A = poseOf(fallbackEl.firstElementChild, base)
    if (!A) return
    const B = poseOf(bandEl.firstElementChild, base) || A
    const f = clamp(fS / .995)
    // the flight: a lift, an arc up and over with a full turn, then he settles into the band and
    // presses flat into the sprite he was built from
    const e = ease.io(inv(.06, .86, f))
    let x = lerp(A.x, B.x, e), y = lerp(A.y, B.y, e)
    y -= Math.sin(Math.PI * e) * Math.min(220, Math.hypot(B.x - A.x, B.y - A.y) * .34)
    const s = A.s * Math.pow(B.s / A.s, ease.io(inv(.04, .9, f)))
    const phi = ease.io(inv(.6, 1, f))             // flattening back into the sprite
    const flatLight = ease.io(inv(.78, 1, f))      // the lighting fades into the sprite's flat colours
    const spin = TAU * ease.io(inv(.08, .82, f))
    const stretch = Math.sin(Math.PI * inv(.1, .86, f)) * .1
    // his idle life fades in after the intro and out as he leaves the stage
    const life = (1 - ease.io(inv(0, .45, f))) * ease.out(clamp(T / 1.5))

    // looking at the pointer, or swaying
    const looking = now - pAt < 3.5
    const yawT = looking ? clamp((px - x) / (W * .45), -1, 1) * .62 : .34 * Math.sin(now * .55)
    const pitchT = looking ? clamp((py - y) / (Hh * .45), -1, 1) * .26 : .04 * Math.sin(now * .41)
    yaw = damp(yaw, yawT, looking ? 5 : 2, dt)
    pitch = damp(pitch, pitchT, looking ? 5 : 2, dt)

    const hp = hopOf(now - hopAt, hops % 4 === 0)
    const pk = now - pokeAt < .45 ? Math.sin((now - pokeAt) * 42) * .08 * (1 - (now - pokeAt) / .45) : 0
    const lv = now - spinAt > 0 && now - spinAt < 1.1 ? TAU * ease.io((now - spinAt) / 1.1) : 0
    const bob = Math.sin(now * 1.7) * .35
    const hopY = hp.y * life
    const SX = (1 + (hp.sx - 1) * life) * (1 - stretch * .5)
    const SY = (1 + (hp.sy - 1) * life) * (1 + stretch)
    model.position.set(x - W / 2, Hh / 2 - y + (bob * life + hopY) * s + SOLE * s * (SY - 1), 0)
    model.scale.set(s * SX, s * SY, s)
    model.rotation.set((.2 + pitch) * life, yaw * life + spin + (hp.spin + lv) * life, pk)

    // the ground shadow stays on the ground through a hop
    const lift = clamp(hopY / 10)
    shade.mesh.position.set(0, -SOLE - .15 - hopY, 0)
    shade.mesh.scale.set(30 * (1 - .35 * lift), 20 * (1 - .35 * lift), 1)
    shade.mat.uniforms.uA.value = .42 * life * (1 - .5 * lift)

    // every voxel: where its rect is now (the sprite's own SMIL), and how far the intro has pushed it out
    const t = bandTime(now)
    const amount = 1 - phi
    posCache.clear()
    crab.flush(now, (c, P, Sc) => {
      let p = posCache.get(c.r)
      if (!p) { p = S.rectAt(c.r, t); posCache.set(c.r, p) }
      const grow = T >= 3 ? 1 : ease.back(clamp((T - (c.wd ?? 0)) / .7))
      return kit.crabPlace(c, p, amount * grow, P, Sc)
    })
    crab.u.uFlat.value = 1 - (1 - flatLight) * ease.out(clamp(T / .9))

    if (gain && (gain.coins > 0 || gain.xp > 0)) {
      const hx = x, hy = y - 10 * s
      if (gain.coins > 0) spawn(Math.min(14, 3 + gain.coins), [kit.H.COLORS.coin, kit.H.COLORS.shine], hx, hy, s)
      if (gain.xp > 0) spawn(Math.min(6, 1 + Math.round(gain.xp / 15)), [kit.H.COLORS.level], hx, hy, s, { size: 1.1 })
    }
    gain = null
    if (level) { spawn(30, [kit.H.COLORS.shine, kit.H.COLORS.level, kit.H.COLORS.coin], x, y - 4 * s, s, { up: 110, spread: 90, size: 1.3, life: 1.5 }); level = false }
    sparkTick(dt)

    gl.render(scene, camera)
    if (!shown) { shown = true; S.glOn('hero') }
  }
}

// ------------------------------------------------------------------ the shop's fitting room: a turntable
function fitting(kit) {
  const { THREE, H } = kit
  const box = document.getElementById('fitting'), cv = document.getElementById('fitGl')
  if (!box || !cv) return null
  let gl
  try { gl = renderer(THREE, cv) } catch (e) { console.warn('No WebGL for the fitting room:', e?.message || e); return null }
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 3000)
  const turn = new THREE.Group()
  const him = new THREE.Group()
  const crab = new kit.Voxels(2400)
  const set = new kit.Voxels(5200)
  const shade = kit.shadow()
  shade.mesh.position.y = -SOLE + .06
  shade.mesh.scale.set(30, 20, 1)
  him.add(crab.mesh)
  turn.add(set.mesh, shade.mesh, him)
  scene.add(turn)

  let W = 1, Hh = 1
  const size = () => {
    W = Math.max(1, cv.clientWidth); Hh = Math.max(1, cv.clientHeight)
    gl.setSize(W, Hh, false)
    camera.aspect = W / Hh
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(size).observe(box)
  size()
  let near = false
  new IntersectionObserver(es => { near = es[0].isIntersecting }, { rootMargin: '10% 0px' }).observe(box)
  let dead = false
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); dead = true; box.classList.remove('gl-on') })

  // what he's trying on, and where
  let crabKey = null, setKey = null, dirty = true, tryAt = -9, scened = false
  // a new island builds out from under his feet, rock last, then the landmarks and the sky
  const buildOrder = c => Math.hypot(c.x, c.z) * .007 + Math.max(0, -SOLE - 3 - c.y) * .012 + (c.y > -SOLE ? .22 + c.y * .006 : 0) + Math.random() * .05
  function sync(now) {
    const o = S.fitOutfit()
    const sceneId = H.SCENES[o.scene] ? o.scene : ''
    const outfit = { ...o }
    delete outfit.scene
    const k = JSON.stringify(outfit)
    const first = crabKey === null
    if (k !== crabKey) {
      crabKey = k
      const list = kit.crabCubes('happy', outfit, { props: false })
      crab.set(list, now, first || S.REDUCED ? { instant: true } : { delay: c => Math.max(0, 14 - c.cy) * .012 + Math.random() * .04, dur: .36 })
      if (!first) tryAt = now
    }
    if (sceneId !== setKey) {
      const was = setKey
      setKey = sceneId
      scened = !!sceneId
      set.set(kit.setCubes(sceneId), now, was === null || S.REDUCED ? { instant: true } : { delay: buildOrder, dur: .5, out: .3 })
    }
  }
  S.on('fit', () => { dirty = true })
  S.on('progress', () => { dirty = true })

  // drag to turn him, with a little momentum; left alone he drifts back to face you
  let yaw = -.42, vel = 0, drag = null, touched = -9
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag = { id: e.pointerId, x: e.clientX, t: performance.now() }
    try { box.setPointerCapture(e.pointerId) } catch {}
    box.classList.add('grabbing')
    vel = 0
  })
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    const t = performance.now(), d = (e.clientX - drag.x) * .0105
    yaw += d
    vel = lerp(vel, d / (Math.max(8, t - drag.t) / 1000), .6)
    drag.x = e.clientX; drag.t = t
    touched = t / 1000
  })
  const end = () => { if (!drag) return; drag = null; box.classList.remove('grabbing'); touched = performance.now() / 1000 }
  box.addEventListener('pointerup', end)
  box.addEventListener('pointercancel', end)

  let dist = 100, lookY = 1, lookZ = 0, isle = 0, shown = false
  return function tick(now, dt) {
    if (dead || !near) return
    if (dirty) { dirty = false; sync(now) }
    if (!drag) {
      yaw += vel * dt
      vel *= Math.exp(-dt * 2.6)
      if (now - touched > 2.8 && Math.abs(vel) < .08 && !S.REDUCED) {
        const home = Math.round(yaw / TAU) * TAU + lerp(-.38, -.22, isle) + lerp(.3, .24, isle) * Math.sin(now * .32)
        yaw = damp(yaw, home, 1.1, dt)
      }
    }
    turn.rotation.y = yaw

    // frame the pedestal, or the whole diorama
    const fov = THREE.MathUtils.degToRad(camera.fov)
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect)
    isle = damp(isle, scened ? 1 : 0, 4, dt)
    const wantH = lerp(25, 36, isle), wantW = lerp(30, 45, isle)
    const want = Math.max(wantH / Math.tan(fov / 2), wantW / Math.tan(hfov / 2))
    dist = damp(dist, want, 4, dt)
    lookY = damp(lookY, scened ? 2 : -1, 4, dt)
    lookZ = damp(lookZ, scened ? -9 : 0, 4, dt)
    const el = lerp(.24, .34, isle)
    camera.position.set(0, lookY + Math.sin(el) * dist, lookZ + Math.cos(el) * dist)
    camera.lookAt(0, lookY, lookZ)
    // the island floats
    turn.position.y = S.REDUCED ? 0 : Math.sin(now * .7) * .8 * isle

    // trying something on: a small hop
    const hp = hopOf(now - tryAt, false, 4, .42)
    him.position.y = hp.y + SOLE * (hp.sy - 1)
    him.scale.set(hp.sx, hp.sy, 1)
    shade.mat.uniforms.uA.value = .5 * (1 - .4 * clamp(hp.y / 4))

    crab.flush(now, (c, P, Sc) => kit.crabPlace(c, S.rectAt(c.r, now), 1, P, Sc))
    set.flush(now, (c, P, Sc) => kit.setPlace(c, P, Sc, S.REDUCED ? 0 : now))
    gl.render(scene, camera)
    if (!shown) { shown = true; S.glOn('fit') }
  }
}
