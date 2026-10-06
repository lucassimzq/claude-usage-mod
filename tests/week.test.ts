import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const DAY = 86_400_000
const MONDAY = Date.parse('2026-10-05T12:00:00Z')

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }
const turn = ($: Engine) =>
  $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: { ...USAGE, model: 'm' } })
const run = async ($: Engine, args: string) => (await $.command.run({ command: 'usage-hud', args } as never)).text
const measure = ($: Engine, weekly: number, resetsAt: number) =>
  $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [{ kind: 'seven_day', percentUsed: weekly, resetsAt: new Date(resetsAt).toISOString() }],
    changed: [],
  })
const band = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'usage-hud', surface, component: 'AbovePrompt', props: { bodyColumns: 120 } as never })

function world(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: MONDAY })
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('session.measure', () => ({ changed: [] }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text?: string }).text ?? JSON.stringify(e))
    return { value: undefined } as never
  })
  return { clock, toasts }
}

test('the first change of a new week files last week as the recap and offers it on the band', async ($, on) => {
  const { clock, toasts } = world(on)
  await measure($, 20, MONDAY + 2 * DAY)
  await turn($)
  await clock.set(MONDAY + DAY)
  await turn($)
  let ui = await band($, 'terminal')
  expect(await ui.find({ type: 'Button', key: 'recap' })).toBeUndefined()
  await ui.unmount()
  // No recap exists yet, so the pane's text shows the week so far.
  expect(await run($, 'recap')).toMatch(/^Week of Oct 5, so far\n.*\nStreak: up to 2 days · active 2 days/)

  await clock.set(MONDAY + 7 * DAY)
  await turn($)
  expect(toasts.join('\n')).toMatch(/week in review is ready/)
  expect(await run($, 'stats')).toMatch(/week in review is ready/)
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await band($, surface)
    expect(await ui.find({ type: 'Button', key: 'recap' })).toBeDefined()
    await ui.unmount()
  }
  // Last week: two turns on two days, 400 tokens written, First Steps.
  const text = await run($, 'recap')
  expect(text).toMatch(/^Week of Oct 5\n/)
  expect(text).toMatch(/Turns: 2 · 400 tokens written/)
  expect(text).toMatch(/Badges: First Steps/)
})

test('the recap pane shows the card, saves it, and Done takes the offer off the band', async ($, on) => {
  const { clock, toasts } = world(on)
  mock.env(on, { HOME: '/home/lucas' })
  const written: string[] = []
  on('fs.write', (_$, e) => {
    written.push(e.path)
    return { value: undefined } as never
  })
  on('fs.exists', (_$, e) => ({ value: e.path === '/home/lucas/Downloads' }) as never)
  const ran: string[] = []
  on('process.run', (_$, e) => {
    ran.push(e.argv[0]!)
    return { value: { exitCode: e.argv[0] === 'rsvg-convert' ? 0 : 1, stdout: '', stderr: '' } } as never
  })
  on('ui.close', () => ({ value: undefined }) as never)
  await measure($, 20, MONDAY + 2 * DAY)
  await turn($)
  await clock.set(MONDAY + 7 * DAY)
  await turn($)

  const ui = await $.ui.mount({ plugin: 'usage-hud', surface: 'desktop', component: 'Pane', requestId: 'recap', props: { bodyColumns: 100 } as never })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Week of Oct 5' })).toBeDefined()
  await ui.press({ key: 'save' })
  expect(written).toEqual(['/home/lucas/Downloads/usage-hud-week-2026-10-05.svg'])
  expect(ran).toEqual(['rsvg-convert'])
  expect(toasts.at(-1)).toBe('Saved usage-hud-week-2026-10-05.png and usage-hud-week-2026-10-05.svg to your Downloads folder.')
  await ui.press({ key: 'done' })
  await ui.unmount()

  const above = await band($, 'desktop')
  expect(await above.find({ type: 'Button', key: 'recap' })).toBeUndefined()
  await above.unmount()
  // Seen: the recap pane now shows this week so far instead.
  expect(await run($, 'recap')).toMatch(/^Week of Oct 12, so far/)
})

test('without a PNG converter the card is saved as SVG alone, in the home folder when there is no Downloads', async ($, on) => {
  world(on)
  mock.env(on, { HOME: '/home/lucas' })
  const written: string[] = []
  on('fs.write', (_$, e) => {
    written.push(e.path)
    return { value: undefined } as never
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('process.run', () => ({ value: { exitCode: 127, stdout: '', stderr: 'not found' } }) as never)
  await measure($, 20, MONDAY + 2 * DAY)
  await turn($)
  expect(await run($, 'card')).toBe('Saved usage-hud-week-2026-10-05.svg to /home/lucas (no PNG converter found on this machine).')
  expect(written).toEqual(['/home/lucas/usage-hud-week-2026-10-05.svg'])
})
