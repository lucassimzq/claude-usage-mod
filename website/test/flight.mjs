// The hero crab's flight into the band, at a few scroll positions
import { open } from './lib.mjs'
const [name = 'desk', W = '1440', Hh = '900', mob] = process.argv.slice(2)
const { browser, page, logs } = await open({ w: +W, h: +Hh, mobile: mob === 'mobile', dpr: mob === 'mobile' ? 2 : 1 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(400)
await page.screenshot({ path: `shots/${name}-fly-intro.png` })
await page.waitForTimeout(2200)
const range = await page.evaluate(() => { const r = document.getElementById('heroBand').getBoundingClientRect(); const top = r.top + scrollY, vh = innerHeight; const s0 = Math.max(0, top - vh * .9), s1 = Math.max(s0 + 260, top - vh * .4); return [s0, s1] })
console.log('range', range)
for (const f of [0, .25, .5, .75, .9, 1]) {
  await page.evaluate(y => scrollTo(0, y), range[0] + (range[1] - range[0]) * f)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `shots/${name}-fly-${Math.round(f * 100)}.png` })
}
console.log(logs.filter(l => !l.includes('GL Driver')).join('\n') || 'no console errors')
await browser.close()
