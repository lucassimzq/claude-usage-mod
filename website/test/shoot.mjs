// node shoot.mjs <name> <w> <h> [mobile]  → a screenshot of each section into shots/
import { open, SECTIONS } from './lib.mjs'
const [name = 'desk', W = '1440', Hh = '900', mob] = process.argv.slice(2)
const { browser, page, logs } = await open({ w: +W, h: +Hh, mobile: mob === 'mobile', dpr: mob === 'mobile' ? 2 : 1 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1800)
for (const id of SECTIONS) {
  await page.evaluate(id => { const el = document.getElementById(id); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - (id === 'top' ? 9999 : 70)) }, id)
  await page.waitForTimeout(1300)
  await page.screenshot({ path: `shots/${name}-${id}.png` })
}
const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
console.log('height', await page.evaluate(() => document.documentElement.scrollHeight), 'horizontal overflow', over)
console.log(logs.join('\n') || 'no console errors')
await browser.close()
