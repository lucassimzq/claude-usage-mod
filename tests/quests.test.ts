import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const DAY = 86_400_000
// A Monday; its three quests are Take 15 turns, Clear the context before it passes 60%, and
// Have Claude write 20k tokens; the week's is Have Claude write 150k tokens this week.
const MONDAY = Date.parse('2026-10-05T12:00:00Z')
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }
const turn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: { ...USAGE, model: 'm' } })
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'usage-hud', args } as never)).text
const measure = ($: Engine, ctx: number) =>
  $.session.measure({
    context: { window: 200_000, percent: ctx },
    rateLimits: [{ kind: 'seven_day', percentUsed: 20, resetsAt: new Date(MONDAY + 2 * DAY).toISOString() }],
    changed: [],
  })

test("today's quests are the same for everyone, pay coins when met, and change with the day", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: MONDAY })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', () => ({ changed: [] }))
  on('ui.toast', () => ({ value: undefined }) as never)

  let text = await run($, 'quests')
  expect(text).toMatch(/^Quests · 0 of 4 done · new ones in 12h 0m/)
  expect(text).toMatch(/☐ Take 15 turns · 0 of 15 · \+20 coins/)
  expect(text).toMatch(/☐ Have Claude write 150k tokens this week · 0 of 150,000 · \+150 coins/)

  for (let i = 0; i < 15; i++) await turn($)
  text = await run($, 'quests')
  expect(text).toMatch(/Quests · 1 of 4 done/)
  expect(text).toMatch(/☑ Take 15 turns · done · \+20 coins/)
  // 15 × 200 written tokens make 3 coins, First Steps 25, reaching level 2 100, the quest 20
  expect(await run($, 'stats')).toMatch(/Coins: 148/)
  expect(await run($, 'stats')).toMatch(/Quests today: 1\/3 done/)

  // A context cleared from 40% down to 5% is the second quest.
  await measure($, 40)
  await measure($, 5)
  expect(await run($, 'quests')).toMatch(/☑ Clear the context before it passes 60% · done/)

  // The band counts them, in the terminal and in the SVG's alt text.
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  expect(await band.find({ type: 'Text', text: /☐2\/3/ })).toBeDefined()
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'usage-hud', surface: 'desktop', component: 'Pane', requestId: 'quests', props: { bodyColumns: 100 } as never })
  expect(await pane.find({ type: 'Text', text: /Quests · 2 of 4 done/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Take 15 turns' })).toBeDefined()
  await pane.unmount()

  // Tuesday brings a fresh three, and yesterday's don't count toward them.
  await clock.set(MONDAY + DAY)
  text = await run($, 'quests')
  expect(text).toMatch(/^Quests · 0 of 4 done/)
  expect(text).toMatch(/☐ Search the web twice · 0 of 2 · \+20 coins/)
})
