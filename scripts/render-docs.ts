// Renders the README images (docs/banner.svg, docs/states/*.svg) from the mod's own
// drawing code, so the pictures always match what the band draws.
//
//   node scripts/render-docs.ts
//
// Needs a Node that strips TypeScript types by itself (23.6 or later).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'hooks/register.tsx'), 'utf8')
const start = source.indexOf('// #region drawing')
const end = source.indexOf('// #endregion drawing')
if (start < 0 || end < 0) throw new Error('hooks/register.tsx has lost its #region drawing markers')

// The region is plain TypeScript with no engine calls: load it as a module of its own.
const tmp = join(tmpdir(), `usage-hud-drawing-${process.pid}.ts`)
writeFileSync(tmp, `${source.slice(start, end)}\nexport { clawdSvg, pixelSvg, tanksOf }\n`)
const { clawdSvg, pixelSvg, tanksOf } = await import(tmp)
rmSync(tmp)

const NOW = Date.parse('2026-10-04T12:00:00Z')
const BAND_W = 660

function snapshot(ctx: number, session: number, weekly: number) {
  return {
    ctxPct: ctx,
    ctxTokens: ctx * 10_000,
    ctxWindow: 1_000_000,
    limits: [
      { kind: 'five_hour', pct: session, resetsAt: new Date(NOW + 111 * 60_000).toISOString() },
      { kind: 'seven_day', pct: weekly, resetsAt: new Date(NOW + 2.2 * 86_400_000).toISOString() },
    ],
    usd: 3.17,
  }
}

// The band as it sits above the prompt: a dark card, the refresh glyph, a mock prompt box.
function card(snap: ReturnType<typeof snapshot>): string {
  const pad = 14
  const w = BAND_W + 30 + pad * 2
  const h = 24 + 10 + 30 + pad * 2
  const scale = 1.25
  const band = pixelSvg(tanksOf(snap, null, NOW), snap.usd, 'idle', BAND_W).replace('<svg ', `<svg x="${pad}" y="${pad}" `)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="#1f1f1f" stroke="#333"/>
  ${band}
  <text x="${pad + BAND_W + 12}" y="${pad + 16.5}" fill="#8b9099" style="font: 14px -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">↻</text>
  <rect x="${pad + 0.5}" y="${pad + 34.5}" width="${w - pad * 2 - 1}" height="29" rx="9" fill="none" stroke="#3a3a3a"/>
  <text x="${pad + 12}" y="${pad + 53.5}" fill="#6b6b6b" style="font: 12.5px -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">Type / for commands</text>
</svg>
`
}

// Stable noise, so the banner's dots don't shift between runs.
function rand(x: number, y: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return v - Math.floor(v)
}

function banner(): string {
  const W = 1280
  const H = 320
  const arcs = [
    { cx: 250, cy: 430, r: 270, t: 64 },
    { cx: 640, cy: 410, r: 250, t: 64 },
    { cx: 1030, cy: 430, r: 270, t: 64 },
  ]
  // Pixel dots in a few opacity steps, one path each, fading behind the title.
  const levels = ['', '', '', '']
  for (let y = 4; y < H; y += 9) {
    for (let x = 4; x < W; x += 9) {
      let v = 0
      for (const a of arcs) v = Math.max(v, 1 - Math.abs(Math.hypot(x - a.cx, y - a.cy) - a.r) / a.t)
      if (Math.abs(x - W / 2) < 360 && y > 120 && y < 280) v *= 0.35
      if (v <= 0 || rand(x, y) > v * 0.95) continue
      levels[Math.min(3, Math.floor(v * 4))] += `M${x} ${y}h2v2h-2z`
    }
  }
  const dots = levels.map((d, i) => `<path d="${d}" fill="#fff" opacity="${(0.1 + i * 0.09).toFixed(2)}"/>`).join('')
  const sans = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="16" fill="#111"/>
  <g shape-rendering="crispEdges">${dots}</g>
  <g transform="translate(${W / 2 - 75} 18) scale(5)" shape-rendering="crispEdges">${clawdSvg('happy', false)}</g>
  <text x="${W / 2}" y="198" text-anchor="middle" fill="#fff" style="font: 700 68px ${sans}; letter-spacing: -1.5px">claude-usage-mod</text>
  <text x="${W / 2}" y="246" text-anchor="middle" fill="#bdbdbd" style="font: 400 24px ${sans}">Your Claude Code limits above the prompt, watched over by Clawd</text>
</svg>
`
}

const states: Record<string, ReturnType<typeof snapshot>> = {
  happy: snapshot(18, 27, 40),
  anxious: snapshot(18, 27, 62),
  frantic: snapshot(18, 27, 92),
  panic: snapshot(18, 27, 97),
  asleep: snapshot(18, 27, 100),
}

mkdirSync(join(root, 'docs/states'), { recursive: true })
writeFileSync(join(root, 'docs/banner.svg'), banner())
for (const [name, snap] of Object.entries(states)) {
  writeFileSync(join(root, `docs/states/${name}.svg`), card(snap))
}
console.log(`wrote docs/banner.svg and ${Object.keys(states).length} state cards`)
