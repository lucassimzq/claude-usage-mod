// Clicks through the interactive parts and checks each one changed what it should
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1500)
let fails = 0
const step = async (name, f) => {
  try { const r = await f(); console.log('ok  ', name, r ?? '') } catch (e) { fails++; console.log('FAIL', name, e.message.split('\n')[0]) }
}
const must = (cond, why) => { if (!cond) throw new Error(why) }
const coins = () => page.evaluate(() => +document.getElementById('purseCoins').textContent.replace(/,/g, ''))

await step('hero band draws', async () => must(await page.$('#heroBand svg'), 'no band svg'))
await step('scroll to the band', async () => { await page.evaluate(() => document.getElementById('band').scrollIntoView()); await page.waitForTimeout(3600) })
await step('chip prompt earns coins', async () => {
  const before = await coins()
  await page.click('#chips button'); await page.waitForTimeout(6500)
  must(await page.$$eval('.msg.bot', m => m.length) === 1, 'no reply')
  return `${before} → ${await coins()}`
})
await step('typed prompt', async () => { await page.fill('#promptInput', 'hello there'); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(6500); must(await page.$$eval('.msg.bot', m => m.length) === 2, 'no second reply') })
await step('slash menu and stats', async () => {
  await page.fill('#promptInput', '/usage-hud s'); await page.waitForTimeout(300)
  must(await page.isVisible('.cmd-menu'), 'menu hidden')
  await page.click('.cmd-menu button[data-cmd="/usage-hud stats"]'); await page.waitForTimeout(800)
  must(/level/i.test(await page.textContent('#convo')), 'no stats')
})
await page.screenshot({ path: 'shots/int-band.png' })
await step('hide and show the band', async () => {
  await page.fill('#promptInput', '/usage-hud hide'); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(800)
  must(!(await page.$eval('#appBand svg', s => s.innerHTML.trim().length)), 'still drawn')
  await page.fill('#promptInput', '/usage-hud show'); await page.press('#promptInput', 'Enter'); await page.waitForTimeout(800)
  must(await page.$eval('#appBand svg', s => s.innerHTML.trim().length), 'not back')
})
await step('slider moves the band', async () => { await page.fill('#r-7d', '88'); await page.waitForTimeout(300); must((await page.textContent('#heroRead')).includes('7d 88%'), 'read-out unchanged') })
await step('activity buttons', async () => {
  await page.click('.seg [data-doing="thinking"]'); await page.waitForTimeout(300)
  must(await page.getAttribute('.seg [data-doing="thinking"]', 'aria-pressed') === 'true', 'not pressed')
  await page.click('.seg [data-doing="idle"]')
})
await step('max out puts the crab to sleep', async () => { await page.click('#maxBtn'); await page.waitForTimeout(1200); must(await page.$('#moodPlates [data-mood="asleep"][data-on]'), 'asleep plate not marked') })
await step('reset', async () => { await page.click('#resetBtn'); await page.fill('#r-7d', '18'); await page.waitForTimeout(800) })
await step('resize handle', async () => {
  const b = await (await page.$('#resize')).boundingBox()
  await page.mouse.move(b.x + 7, b.y + 20); await page.mouse.down(); await page.mouse.move(b.x - 380, b.y + 20, { steps: 8 }); await page.mouse.up()
  await page.waitForTimeout(400)
  const w = await page.textContent('#widthRead')
  must(parseInt(w.replace(/,/g, '')) < 500, w)
  return w
})
await page.screenshot({ path: 'shots/int-narrow.png' })
await step('mood figure answers the pointer', async () => {
  await page.evaluate(() => document.getElementById('moods').scrollIntoView()); await page.waitForTimeout(1200)
  const b = await (await page.$('#figMood')).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.78); await page.waitForTimeout(1000)
  const low = await page.textContent('#moodName')
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.2); await page.waitForTimeout(1000)
  const high = await page.textContent('#moodName')
  must(low !== high, `stayed ${low}`)
  return `${low} → ${high}`
})
await step('shop: tabs, drawer, buy, wear', async () => {
  await page.evaluate(() => document.getElementById('shop').scrollIntoView()); await page.waitForTimeout(1200)
  await page.click('#tab-face'); await page.waitForTimeout(300)
  const before = await coins()
  const buy = await page.$('#tiles .tile:has(.tag:text-is("Buy"))')
  must(buy, 'nothing to buy')
  await buy.click(); await page.waitForTimeout(500)
  must(await page.getAttribute('#drawer', 'data-open') !== null, 'drawer shut')
  await page.screenshot({ path: 'shots/int-drawer.png' })
  await page.click('#drawerAct'); await page.waitForTimeout(800)
  const after = await coins()
  must(after < before, 'coins unchanged')
  must(/Take it off/.test(await page.textContent('#drawerAct')), 'not wearing it')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  must(await page.getAttribute('#drawer', 'data-open') === null, 'drawer still open')
  return `${before} → ${after}`
})
await step('+500 coins', async () => { const b = await coins(); await page.click('#earnBtn'); await page.waitForTimeout(300); must(await coins() === b + 500, 'no coins') })
await step('reel plays', async () => {
  await page.evaluate(() => document.getElementById('reel').scrollIntoView()); await page.waitForTimeout(800)
  await page.click('#reelPlay'); await page.waitForTimeout(2500)
  const v = await page.evaluate(() => { const v = document.getElementById('reelVideo'); return { src: v.currentSrc.split('/').pop(), t: +v.currentTime.toFixed(1), err: v.error?.code } })
  must(!v.err && v.t > 0, JSON.stringify(v))
  return JSON.stringify(v)
})
await step('copy button', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => document.getElementById('install').scrollIntoView()); await page.waitForTimeout(600)
  await page.click('#install [data-copy] >> nth=0'); await page.waitForTimeout(300)
  must(/claude-usage-mod/.test(await page.evaluate(() => navigator.clipboard.readText())), 'clipboard empty')
})
console.log(logs.join('\n') || 'no console errors')
console.log(fails ? `${fails} failed` : 'all passed')
await browser.close()
process.exit(fails ? 1 : 0)
