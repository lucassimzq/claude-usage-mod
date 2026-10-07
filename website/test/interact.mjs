// Clicks through the interactive parts and reports console errors
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
const step = async (name, f) => { try { await f(); console.log('ok  ', name) } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) } }
await step('hero crab click x4', async () => { for (let i = 0; i < 4; i++) { await page.click('#heroStage'); await page.waitForTimeout(700) } })
await page.screenshot({ path: 'shots/int-hero.png' })
await step('scroll to try', async () => { await page.evaluate(() => document.getElementById('try').scrollIntoView()); await page.waitForTimeout(800) })
await step('chip prompt', async () => { await page.click('#chips button'); await page.waitForTimeout(6000) })
await step('typed prompt', async () => { await page.fill('#promptInput', 'hello there'); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(6000) })
await step('slash menu', async () => { await page.fill('#promptInput', '/'); await page.waitForTimeout(400); await page.screenshot({ path: 'shots/int-slash.png' }); const b = await page.$('.cmd-menu button'); if (b) await b.click(); await page.waitForTimeout(1200) })
await page.screenshot({ path: 'shots/int-try.png' })
await step('max out', async () => { await page.click('#maxBtn'); await page.waitForTimeout(1500) })
await step('reset', async () => { await page.click('#resetBtn'); await page.waitForTimeout(1500) })
await page.screenshot({ path: 'shots/int-try2.png' })
await step('shop buy', async () => {
  await page.evaluate(() => document.getElementById('shop').scrollIntoView()); await page.waitForTimeout(800)
  const buys = await page.$$('#items [data-id]')
  for (const b of buys) { const t = await b.textContent(); if (/BUY/i.test(t)) { await b.click(); break } }
  await page.waitForTimeout(1500)
})
await page.screenshot({ path: 'shots/int-shop.png' })
await step('sync reply', async () => {
  await page.evaluate(() => document.getElementById('syncDemo').scrollIntoView({ block: 'center' })); await page.waitForTimeout(800)
  const b = await page.$('#syncDemo button'); if (b) await b.click(); await page.waitForTimeout(2500)
})
await step('update', async () => { await page.evaluate(() => document.getElementById('updBtn').scrollIntoView({ block: 'center' })); await page.waitForTimeout(500); await page.click('#updBtn'); await page.waitForTimeout(6000) })
await page.screenshot({ path: 'shots/int-hood.png' })
await step('reel modal', async () => {
  await page.evaluate(() => document.getElementById('reel').scrollIntoView()); await page.waitForTimeout(800)
  await page.click('[data-reel]'); await page.waitForTimeout(1500)
  await page.screenshot({ path: 'shots/int-modal.png' })
  await page.keyboard.press('Escape'); await page.waitForTimeout(600)
})
await step('copy buttons', async () => { await page.evaluate(() => document.getElementById('install').scrollIntoView()); const b = await page.$('#install button.copy, #install [data-copy]'); if (b) await b.click(); await page.waitForTimeout(500) })
await step('footer sleeper', async () => { await page.evaluate(() => document.getElementById('foot').scrollIntoView()); await page.waitForTimeout(800); await page.click('#sleeper'); await page.waitForTimeout(3000) })
console.log(logs.filter(l => !l.includes('GL Driver') && !l.includes('ReadPixels')).join('\n') || 'no console errors')
await browser.close()
