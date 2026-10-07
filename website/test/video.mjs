// The reel: the teaser loops in its frame, and the play button opens the full reel with sound
import { open } from './lib.mjs'
const { browser, page, logs } = await open({ w: 1440, h: 900 })
await page.goto('http://localhost:8765/', { waitUntil: 'load' })
await page.waitForTimeout(1000)
await page.evaluate(() => document.getElementById('reel').scrollIntoView())
await page.waitForTimeout(2500)
console.log('teaser', await page.evaluate(() => { const t = document.getElementById('teaser'); return { src: t.currentSrc, t: t.currentTime, op: t.style.opacity, err: t.error?.code } }))
await page.click('[data-reel]')
await page.waitForTimeout(3000)
console.log('reel', await page.evaluate(() => { const v = document.getElementById('reelVideo'); return { src: v.currentSrc, t: v.currentTime, paused: v.paused, err: v.error?.code } }))
await page.screenshot({ path: 'shots/vid-modal.png' })
console.log(logs.filter(l => !l.includes('GL Driver')).join('\n') || 'no console errors')
await browser.close()
