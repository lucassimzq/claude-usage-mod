// Reduced motion: the page should be complete and still, with the 2D crab in the hero
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900, reduced: true })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2000)
await page.screenshot({ path: 'shots/red-top.png' })
for (const id of ['moods', 'levels', 'shop', 'backdrops', 'foot']) {
  await page.evaluate(id => { const el = document.getElementById(id); scrollTo(0, el.getBoundingClientRect().top + scrollY + (['moods', 'levels', 'backdrops'].includes(id) ? innerHeight * 1.4 : 0)) }, id)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `shots/red-${id}.png` })
}
console.log(logs.filter(l => !l.includes('GL Driver')).join('\n') || 'no console errors')
await browser.close()
