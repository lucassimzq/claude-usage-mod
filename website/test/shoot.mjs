// node shoot.mjs <name> <w> <h> [mobile]  → screenshots down the page
import { open } from './lib.mjs'
const [name = 'desk', W = '1440', Hh = '900', mob] = process.argv.slice(2)
const { browser, page, logs } = await open({ w: +W, h: +Hh, mobile: mob === 'mobile', dpr: mob === 'mobile' ? 2 : 1 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
const shot = async (tag) => page.screenshot({ path: `shots/${name}-${tag}.png` })
await shot('00-top')
const total = await page.evaluate(() => document.documentElement.scrollHeight)
const ids = ['try', 'moods', 'levels', 'xp', 'shop', 'backdrops', 'hood', 'reel', 'install', 'foot']
for (const id of ids) {
  await page.evaluate(id => { const el = document.getElementById(id); window.scrollTo(0, el.getBoundingClientRect().top + scrollY + (['moods', 'levels', 'backdrops'].includes(id) ? innerHeight * 1.4 : 0)) }, id)
  await page.waitForTimeout(1200)
  await shot(id)
}
console.log('height', total)
console.log(logs.join('\n') || 'no console errors')
await browser.close()
