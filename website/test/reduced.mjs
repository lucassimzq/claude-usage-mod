// Reduced motion: every section complete and still on arrival
import { open, SECTIONS } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900, reduced: true })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1200)
for (const id of SECTIONS) {
  await page.evaluate(id => document.getElementById(id).scrollIntoView(), id)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `shots/red-${id}.png` })
}
const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal] > *')].filter(e => getComputedStyle(e).opacity < 0.99).length)
console.log('blocks not fully shown:', hidden)
console.log(logs.join('\n') || 'no console errors')
await browser.close()
process.exit(hidden ? 1 : 0)
