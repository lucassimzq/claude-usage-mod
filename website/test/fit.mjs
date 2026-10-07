// The fitting room: in view with no backdrop, previewing a hat, previewing a backdrop, and after a drag
import { open } from './lib.mjs'
const [name = 'desk', W = '1440', Hh = '900', mob] = process.argv.slice(2)
const { browser, page, logs } = await open({ w: +W, h: +Hh, mobile: mob === 'mobile', dpr: mob === 'mobile' ? 2 : 1 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.evaluate(() => { const el = document.getElementById('fitting'); scrollTo(0, el.getBoundingClientRect().top + scrollY - 90) })
await page.waitForTimeout(2000)
await page.screenshot({ path: `shots/${name}-fit-0.png` })
const tabs = await page.$$eval('#tabs .tab', els => els.map(e => e.textContent.trim()))
console.log('tabs', tabs)
// hover the first item on the hat tab
const first = await page.$('#items [data-id]')
if (first) { await first.hover(); await page.waitForTimeout(1300); await page.screenshot({ path: `shots/${name}-fit-hat.png` }) }
// backdrop tab
const bt = await page.$$('#tabs .tab')
for (const t of bt) { if ((await t.textContent()).includes('Backdrop')) { await t.click(); break } }
await page.waitForTimeout(500)
const items = await page.$$('#items [data-id]')
console.log('backdrop items', await Promise.all(items.map(i => i.getAttribute('data-id'))))
for (const [k, i] of items.entries()) {
  if (k > 6) break
  await i.hover(); await page.waitForTimeout(1300)
  await page.screenshot({ path: `shots/${name}-fit-scene-${k}.png` })
}
// drag to turn
const box = await (await page.$('#fitting')).boundingBox()
await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(400)
await page.screenshot({ path: `shots/${name}-fit-drag.png` })
console.log(logs.filter(l => !l.includes('GL Driver') && !l.includes('ReadPixels')).join('\n') || 'no console errors')
await browser.close()
