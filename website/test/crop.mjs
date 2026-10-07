// node crop.mjs <w> <dpr> → close-ups of type at the given width and pixel ratio
import { open } from './lib.mjs'
const [W = '1440', D = '2'] = process.argv.slice(2)
const { browser, page, logs } = await open({ w: +W, h: 900, dpr: +D })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.evaluate(() => document.fonts.ready)
const clip = async (sel, tag, pad = 16) => {
  await page.evaluate(sel => { const el = document.querySelector(sel); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 120, behavior: 'instant' }) }, sel)
  await page.waitForTimeout(900)
  const b = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } }, sel)
  await page.screenshot({ path: `shots/crop-${W}-${tag}.png`, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(+W, b.width + pad * 2), height: Math.min(860, b.height + pad * 2) } })
}
await page.screenshot({ path: `shots/crop-${W}-hero.png`, clip: { x: 0, y: 0, width: Math.min(+W, 820), height: 600 } })
await clip('.formula', 'formula')
await clip('#shop .chapter-tag', 'tag', 8)
await clip('.wallet', 'wallet', 8)
await clip('.moods-steps', 'steps', 8)
const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight} ${f.stretch}`))
console.log([...new Set(fonts)].join('\n'))
console.log(logs.filter(l => !l.includes('GPU stall')).join('\n') || 'no console errors')
await browser.close()
