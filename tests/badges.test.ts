import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOON = Date.parse('2026-10-05T12:00:00Z')
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }
const turn = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: { ...USAGE, model: 'm' }, agentId })
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'usage-hud', args } as never)).text
const PANE = { plugin: 'usage-hud', component: 'Pane', requestId: 'badges', props: { bodyColumns: 100 } as never } as const

test('the trophy case shows what was earned and how far along the rest are', async ($, on) => {
  mock.store(on, { progress: { xp: 100, streak: { count: 12, best: 12, restDays: 0, lastDay: '2026-10-05' }, badges: { 'first-steps': '2026-10-01' } } })
  mock.clock(on, { now: NOON })
  on('command.run', () => ({ text: '' }))

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /Badges · 1 of 18/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /★ First Steps · your first turn with Clawd · earned Oct 1/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /☆ Unstoppable · a 30-day streak · ▰▰▱▱▱▱ 12 of 30 days/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /☆ Pumpkin Patch · .* · Oct 25 to 31/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ type: 'Svg', alt: 'First Steps, earned' } as never)).toBeDefined()
  expect(await desktop.find({ type: 'Svg', alt: 'Unstoppable, not yet' } as never)).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '12 of 30 days' })).toBeDefined()
  await desktop.unmount()

  // The same list as text, where the pane can't be drawn.
  expect(await run($, 'badges')).toMatch(/^Badges · 1 of 18 · each worth 50 XP and 25 coins\n★ First Steps/)
})

test('Comeback, Delegator, Scholar and Clean Exit', async ($, on) => {
  // Last turn 25 days ago: the streak restarts, and that's a comeback.
  mock.store(on, { progress: { streak: { count: 5, best: 5, restDays: 0, lastDay: '2026-09-10' } } })
  mock.clock(on, { now: NOON })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', () => ({ changed: [] }))
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], changed: [] })
  for (let i = 0; i < 10; i++) await turn($, 'sub')
  for (let i = 0; i < 50; i++) await $.tool.call({ tool: 'WebSearch', query: 'crabs', tool_use_id: `s${i}` } as never)
  await turn($)
  let stats = await run($, 'stats')
  expect(stats).toMatch(/Streak: 1 day \(best 5\)/)
  expect(stats).toMatch(/Badges 4\/18: First Steps, Delegator, Scholar, Comeback/)

  // Fifty turns in a session whose context never passed 60%.
  for (let i = 0; i < 49; i++) await turn($)
  stats = await run($, 'stats')
  expect(stats).toMatch(/Clean Exit/)
})
