// Watches every bit of text the page adds while it is used, for the mascot's name
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.addInitScript(() => {
  window.__hits = []
  const scan = n => { const t = (n.textContent || '') + ' ' + (n.getAttribute?.('aria-label') || ''); if (/clawd/i.test(t)) window.__hits.push(t.slice(0, 160)) }
  new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(n => scan(n)); if (m.type === 'characterData') scan(m.target.parentElement || m.target) })).observe(document, { subtree: true, childList: true, characterData: true })
})
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2000)
const say = async t => { await page.fill('#promptInput', t); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(5000) }
await page.evaluate(() => document.getElementById('try').scrollIntoView())
await page.waitForTimeout(600)
for (const t of ['/usage-hud stats', '/usage-hud shop', 'fix the bug', '/usage-hud']) await say(t)
await page.click('#maxBtn'); await page.waitForTimeout(1500)
await page.evaluate(() => document.getElementById('shop').scrollIntoView()); await page.waitForTimeout(600)
const nt = (await page.$$('#tabs .tab')).length
for (let k = 0; k < nt; k++) {
  await page.click(`#tabs .tab >> nth=${k}`); await page.waitForTimeout(300)
  for (let j = 0; j < 3; j++) { try { await page.click(`#items [data-id] >> nth=${j}`, { timeout: 2000 }); await page.waitForTimeout(400) } catch {} }
  try { await page.click(`#items [data-id] >> nth=0`, { timeout: 2000 }); await page.waitForTimeout(400) } catch {}
}
for (const id of ['xp', 'levels', 'hood', 'foot']) { await page.evaluate(id => document.getElementById(id).scrollIntoView(), id); await page.waitForTimeout(800) }
const body = await page.evaluate(() => document.body.innerText)
console.log('hits while used:', await page.evaluate(() => window.__hits))
console.log('in body text:', /clawd/i.test(body))
console.log(logs.filter(l => !l.includes('GL Driver')).join('\n') || 'no console errors')
await browser.close()
