// Watches every bit of text the page adds while it is used, for the mascot's name
import { open, SECTIONS } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.addInitScript(() => {
  window.__hits = []
  const scan = n => { const t = (n.textContent || '') + ' ' + (n.getAttribute?.('aria-label') || ''); if (/clawd/i.test(t)) window.__hits.push(t.slice(0, 160)) }
  new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(n => scan(n)); if (m.type === 'characterData') scan(m.target.parentElement || m.target) })).observe(document, { subtree: true, childList: true, characterData: true })
})
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1500)
const say = async t => { await page.fill('#promptInput', t); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(6000) }
await page.evaluate(() => document.getElementById('band').scrollIntoView())
for (const t of ['/usage-hud stats', 'fix the bug', '/usage-hud']) await say(t)
await page.click('#maxBtn'); await page.waitForTimeout(1500)
await page.evaluate(() => document.getElementById('shop').scrollIntoView()); await page.waitForTimeout(600)
await page.click('#earnBtn'); await page.click('#earnBtn')
const tabs = await page.$$eval('#tabs [role=tab]', t => t.map(b => b.id))
for (const tab of tabs) {
  await page.click('#' + tab); await page.waitForTimeout(200)
  const n = await page.$$eval('#tiles .tile', t => t.length)
  for (let j = 0; j < n; j++) {
    await page.click(`#tiles .tile >> nth=${j}`); await page.waitForTimeout(150)
    const act = await page.$('#drawerAct:not([disabled])')
    if (act) { await act.click(); await page.waitForTimeout(150) }
    await page.keyboard.press('Escape')
  }
}
for (const id of SECTIONS) { await page.evaluate(id => document.getElementById(id).scrollIntoView(), id); await page.waitForTimeout(500) }
const body = await page.evaluate(() => document.body.innerText + document.title)
const hits = await page.evaluate(() => window.__hits)
console.log('hits while used:', hits)
console.log('in body text:', /clawd/i.test(body))
console.log(logs.join('\n') || 'no console errors')
await browser.close()
process.exit(hits.length || /clawd/i.test(body) ? 1 : 0)
