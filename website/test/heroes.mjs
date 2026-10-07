// node heroes.mjs → the first screen at a few desktop sizes
import { open } from './lib.mjs'
for (const [w, h] of [[1920, 1080], [1280, 800], [1100, 760]]) {
  const { browser, page, logs } = await open({ w, h })
  await page.goto('http://localhost:8765/', { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `shots/hero-${w}.png` })
  const lines = await page.evaluate(() => { const t = document.querySelector('.hero-title'); return Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) })
  console.log(w, 'headline lines', lines, logs.filter(l => !l.includes('GPU stall')).join(' ') || 'ok')
  await browser.close()
}
