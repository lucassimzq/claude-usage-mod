import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const DAY = 86_400_000
const NOON = Date.parse('2026-10-05T12:00:00Z')

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }

const turn = ($: Engine, agentId?: string) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: { ...USAGE, model: 'm' }, agentId })

const stats = async ($: Engine) => (await $.command.run({ command: 'usage-hud', args: 'stats' })).text

const measure = ($: Engine, weekly: number, resetsAt: number) =>
  $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [{ kind: 'seven_day', percentUsed: weekly, resetsAt: new Date(resetsAt).toISOString() }],
    changed: [],
  })

test('turns earn XP, a daily bonus and First Steps', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOON })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))

  await turn($)
  await turn($)
  await turn($, 'sub') // a subagent's turn earns nothing
  // 25 daily + 2 × 10 per turn + 50 for First Steps
  expect(await stats($)).toMatch(/level 1, Hatchling · 95 XP/)
  expect(await stats($)).toMatch(/Streak: 1 day/)
  expect(await stats($)).toMatch(/Badges 1\/13: First Steps/)
  expect(await stats($)).toMatch(/Turns: 2 · tokens: 12k in, 400 out/)
})

test('a rest day earned at seven days covers a missed day', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOON })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))

  for (let d = 0; d < 7; d++) {
    await clock.set(NOON + d * DAY)
    await turn($)
  }
  expect(await stats($)).toMatch(/Streak: 7 days \(best 7\) · 1 rest day saved/)
  expect(await stats($)).toMatch(/On a Roll/)

  await clock.set(NOON + 8 * DAY) // day 7 missed
  await turn($)
  expect(await stats($)).toMatch(/Streak: 8 days \(best 8\) · 0 rest days saved/)

  await clock.set(NOON + 10 * DAY) // another miss, no rest day left
  await turn($)
  expect(await stats($)).toMatch(/Streak: 1 day \(best 8\)/)
})

test('weekly points earn XP, and a week that peaked at 95–99% earns Close Call', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOON })
  on('session.measure', () => ({ changed: [] }))
  on('command.run', () => ({ text: '' }))

  const reset = NOON + 2 * DAY
  await measure($, 40, reset) // first sight: nothing for what came before
  expect(await stats($)).toMatch(/· 0 XP/)
  await measure($, 46, reset)
  expect(await stats($)).toMatch(/· 30 XP/)
  await measure($, 97, reset)
  expect(await stats($)).toMatch(/· 285 XP/)

  await clock.set(reset + DAY)
  await measure($, 3, reset + 7 * DAY)
  // 285 + 3 points of the new week + 50 for the badge
  expect(await stats($)).toMatch(/Close Call/)
  expect(await stats($)).toMatch(/· 350 XP/)
})

test('wear picks only what is owned', async ($, on) => {
  mock.store(on, { progress: { xp: 1000 } })
  mock.clock(on, { now: NOON })
  on('command.run', () => ({ text: '' }))

  const wear = async (item: string) => (await $.command.run({ command: 'usage-hud', args: `wear ${item}` })).text
  expect(await wear('cape')).toBe('The cape unlocks at level 20.')
  expect(await wear('crown')).toMatch(/doesn't have the crown yet: it's 2,000 coins/)
  // Level 5 unlocks the scarf and the beanie, and both are worn at once
  expect(await stats($)).toMatch(/wearing: beanie, scarf/)
  expect(await $.command.run({ command: 'usage-hud', args: 'remove hat' }).then(r => r.text)).toMatch(/isn't wearing that/)
  expect(await $.command.run({ command: 'usage-hud', args: 'remove head' }).then(r => r.text)).toBe('Took off the beanie.')
  expect(await stats($)).toMatch(/wearing: scarf/)
})

test('the shop sells for coins, and coins come from written tokens, levels and badges', async ($, on) => {
  mock.store(on, { progress: { xp: 1000, coins: 200, coinTokens: 900 } })
  mock.clock(on, { now: NOON })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  const run = async (args: string) => (await $.command.run({ command: 'usage-hud', args })).text

  // 900 + 200 written tokens make one coin; First Steps adds 25
  await turn($)
  expect(await stats($)).toMatch(/Coins: 226/)
  expect(await run('shop list')).toMatch(/Head: beanie free at level 5 \(wearing\) · .* · flower 80 · cap 100 · party hat 150 · halo 1,200 \(needs level 15\)/)
  expect(await run('buy crown')).toBe('The crown needs level 20, and Clawd is level 5.')
  expect(await run('buy the party hat')).toBe("Bought the party hat for 150 coins, and Clawd's wearing it. 76 coins left.")
  expect(await run('buy party')).toMatch(/already have the party hat/)
  expect(await run('buy monocle')).toBe('The monocle costs 300 coins and you have 76.')
  expect(await stats($)).toMatch(/wearing: party hat, scarf/)
})

test('the band shows the level on every surface, and gives it up when narrow', async ($, on) => {
  mock.store(on, { progress: { xp: 5000, streak: { count: 4, best: 4, restDays: 0, lastDay: '2026-10-05' } } })
  mock.clock(on, { now: NOON })
  on('session.measure', () => ({ changed: [] }))
  await measure($, 20, NOON + DAY)

  const terminal = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  expect(await terminal.find({ type: 'Text', text: /Lv10/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /🔥4/ })).toBeDefined()
  await terminal.unmount()

  const narrow = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 40 } as never })
  expect(await narrow.find({ type: 'Text', text: /Lv10/ })).toBeUndefined()
  await narrow.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ plugin: 'usage-hud', surface, component: 'AbovePrompt', props: { bodyColumns: surface === 'mobile' ? 44 : 120 } as never })
    expect(await band.find({ type: 'Svg' })).toBeDefined()
    expect(await band.find({ type: 'Button', key: 'refresh' })).toBeDefined()
    await band.unmount()
  }
})

test('reaching 100% pays out at once, only once per window', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOON })
  on('session.measure', () => ({ changed: [] }))
  on('command.run', () => ({ text: '' }))

  const reset = NOON + 2 * DAY
  await measure($, 98, reset)
  await measure($, 100, reset)
  // 2 weekly points × 5 + 150 for maxing the week + 50 for the badge
  expect(await stats($)).toMatch(/· 210 XP/)
  expect(await stats($)).toMatch(/Maxed Out/)
  await measure($, 100, reset)
  expect(await stats($)).toMatch(/· 210 XP/)
})
