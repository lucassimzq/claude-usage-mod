// Opens the page in headless Chromium with software WebGL. Playwright comes from a local or a global npm install.
// The page loads three.js from jsdelivr; set THREE_JS to a local three.module.min.js (three@0.170.0) to test offline.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const resolve = name => {
  try { return require.resolve(name) } catch { return require.resolve(name, { paths: [execSync('npm root -g').toString().trim()] }) }
}
const pw = await import(pathToFileURL(resolve('playwright')).href)
const { chromium } = pw.chromium ? pw : pw.default
mkdirSync('shots', { recursive: true })
export async function open({ w = 1440, h = 900, dpr = 1, mobile = false, reduced = false } = {}) {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-accelerated-2d-canvas', '--disable-gpu-compositing', '--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('GL Driver')) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
  if (process.env.THREE_JS) await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', r => r.fulfill({ body: readFileSync(process.env.THREE_JS), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }))
  return { browser, page, logs }
}
