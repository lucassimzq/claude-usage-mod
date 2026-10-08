// Opens the page in headless Chromium. Playwright comes from a local or a global npm install.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const resolve = name => {
  try { return require.resolve(name) } catch { return require.resolve(name, { paths: [execSync('npm root -g').toString().trim()] }) }
}
const pw = await import(pathToFileURL(resolve('playwright')).href)
const { chromium } = pw.chromium ? pw : pw.default
mkdirSync('shots', { recursive: true })
export async function open({ w = 1440, h = 900, dpr = 1, mobile = false, reduced = false } = {}) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const page = await ctx.newPage()
  const logs = []
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
  return { browser, page, logs }
}
// Every section's id, top to bottom.
export const SECTIONS = ['top', 'band', 'moods', 'levels', 'shop', 'hood', 'reel', 'install']
