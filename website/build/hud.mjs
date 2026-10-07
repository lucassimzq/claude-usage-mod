// node website/build/hud.mjs [commit]
// Copies the mod's pure drawing and game regions out of hooks/register.tsx at a release commit, strips the
// TypeScript with Node's own stripper, and wraps them as a classic script that sets window.HUD.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const out = fileURLToPath(new URL('../site/hud.js', import.meta.url))
const COMMIT = process.argv[2] ?? 'f9eac9b' // v1.0.0
const source = execFileSync('git', ['-C', repo, 'show', `${COMMIT}:hooks/register.tsx`]).toString()
const slice = (a, b) => {
  const s = source.indexOf(a), e = source.indexOf(b)
  if (s < 0 || e < 0) throw new Error(`lost ${a}`)
  return source.slice(s, e)
}
const code = [
  slice('// #region drawing', '// #endregion drawing'),
  slice('// #region game', '// #endregion game'),
].join('\n')

const names = [
  // drawing
  'clawdSvg', 'pixelSvg', 'tanksOf', 'wardrobeSvg', 'sceneSvg', 'gameSvg', 'barSvg', 'noteSvg', 'noteOf', 'shortNoteOf',
  'planOf', 'moodOf', 'tone', 'coinsLabel', 'textWidth', 'textPixels', 'pixels', 'untilReset', 'tokens',
  'FONT', 'COIN', 'SPARKLE', 'COLORS', 'SHELLS', 'TONES', 'CLAWD', 'INK', 'MUTED', 'ITEMS', 'LEVELS', 'SLOTS', 'SLOT_NAMES',
  'SCENES', 'SCENE_W', 'SCENE_P', 'GROUND_Y', 'SCENE_OPACITY', 'FACES', 'GAIN_MS', 'SWEEP_MS', 'SPRITE_W', 'HEIGHT', 'PX_PER_COLUMN',
  'REFRESH_W', 'levelOf', 'xpFor', 'fracOf', 'titleOf', 'itemsOf', 'outfitOf', 'gameViewOf', 'dayOf', 'liveStreak',
  'HEADPHONES', 'NOTE', 'BODY', 'EYES', 'FLAME_A', 'FLAME_B', 'ZED', 'TINY_CRAB', 'PLANT', 'PINE', 'PALM', 'COIN_TURN',
  // game
  'XP', 'COINS', 'BADGES', 'newProgress', 'progressOf', 'afterTurn', 'afterMeasure', 'shelfOf', 'pressOf', 'bought', 'dressed', 'undressed', 'statsOf',
]
const js = stripTypeScriptTypes(code)

writeFileSync(out, `// The usage-hud mod's own drawing and game code (hooks/register.tsx at ${COMMIT}, #region drawing and
// #region game), with the TypeScript stripped. Every crab, band, outfit and backdrop on this page comes from it.
;(function () {
'use strict'
${js}
window.HUD = { ${names.join(', ')} }
})()
`)
console.log('wrote', out, (js.length / 1024).toFixed(1), 'KB')
