import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOON = Date.parse('2026-10-05T12:00:00Z')
const CRAB = 'fill="#D97757"'

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const measure = ($: Engine) =>
  $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], changed: [] })
// A turn at work: a tool call in the main conversation.
const work = ($: Engine) => $.tool.call({ tool: 'Read', input: { file_path: '/work/a' }, toolUseId: 'tu1' } as never)
const finish = ($: Engine) =>
  $.turn.complete({
    answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer',
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
  })

function world(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: NOON })
  mock.env(on, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  on('fs.read', () => ({ value: '{ "version": "0.0.1" }' }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOON, context: { window: 200_000, percent: 10 }, rateLimits: [] } }) as never)
  on('session.measure', () => ({ changed: [] }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ deny: 'not in a test' }))
  // The engine's own spinner row, standing in for the real one.
  on('ui.render', { component: 'Spinner' }, () => ({ type: 'Text', props: {}, children: ['Sauteing…'] }) as never)
  return clock
}

const band = ($: Engine, surface: 'desktop' | 'terminal' | 'vscode', isWorking: boolean) =>
  $.ui.mount({ plugin: 'usage-hud', surface, component: 'AbovePrompt', props: { bodyColumns: 120, isWorking } as never })
const spinner = ($: Engine, surface: 'desktop' | 'terminal') =>
  $.ui.mount({ plugin: 'usage-hud', surface, component: 'Spinner', props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' } })
// The tree as text, its SVG markup unescaped, so a test can look for what it draws.
const drawn = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn()).replace(/\\"/g, '"')

test('while a turn runs the crab leaves the desktop band for the spinner', async ($, on) => {
  world(on)
  await start($)
  await measure($)

  const idle = await band($, 'desktop', false)
  expect(await drawn(idle)).toContain(CRAB)
  await idle.unmount()

  const working = await band($, 'desktop', true)
  expect(await drawn(working)).not.toContain(CRAB)
  await working.unmount()

  const row = await spinner($, 'desktop')
  const tree = await drawn(row)
  expect(tree).toContain(CRAB)
  expect(tree).toContain('Sauteing…') // the engine's own words and timer stay
  await row.unmount()
})

test('he jumps off the band as a turn starts, lands on the spinner, and jumps back at the end', async ($, on) => {
  const clock = world(on)
  await start($)
  await measure($)
  await work($)

  const leaving = await band($, 'desktop', true)
  expect(await drawn(leaving)).toContain('values="0 0;0 1;0 -4') // crouch, then leap off the top
  await leaving.unmount()
  const row = await spinner($, 'desktop')
  expect(await drawn(row)).toContain('values="0 -26') // and drop onto the spinner
  await row.unmount()

  await clock.set(NOON + 30_000)
  await finish($)

  const landing = await band($, 'desktop', false)
  expect(await drawn(landing)).toContain('values="0 -26')
  await landing.unmount()

  await clock.set(NOON + 35_000)
  const settled = await band($, 'desktop', false)
  const tree = await drawn(settled)
  expect(tree).toContain(CRAB)
  expect(tree).not.toContain('values="0 -26')
  await settled.unmount()
})

test('in the terminal the face moves to the spinner line', async ($, on) => {
  world(on)
  await start($)
  await measure($)
  const working = await band($, 'terminal', true)
  expect(await working.find({ type: 'Text', text: /\(\^‿\^\)/ })).toBeUndefined()
  await working.unmount()
  const row = await spinner($, 'terminal')
  expect(await row.find({ type: 'Text', text: /\(\^‿\^\)/ })).toBeDefined()
  await row.unmount()
})

test('VS Code draws no spinner of ours, so the crab stays on the band', async ($, on) => {
  world(on)
  await start($)
  await measure($)
  const working = await band($, 'vscode', true)
  expect(await drawn(working)).toContain(CRAB)
  await working.unmount()
})
