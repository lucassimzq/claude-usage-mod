// The reel: the poster shows, and the play button loads and plays the full reel
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.evaluate(() => document.getElementById('reel').scrollIntoView())
await page.waitForTimeout(800)
await page.click('#reelPlay')
await page.waitForTimeout(3000)
const v = await page.evaluate(() => { const v = document.getElementById('reelVideo'); return { src: v.currentSrc.split('/').pop(), t: v.currentTime, paused: v.paused, err: v.error?.code } })
console.log('reel', v)
console.log(logs.join('\n') || 'no console errors')
await browser.close()
process.exit(v.err || !(v.t > 0) ? 1 : 0)
