import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOON = Date.parse('2026-10-06T12:00:00Z')
const HOUR = 3_600_000
const RESETS = new Date(NOON + 3 * HOUR).toISOString()
const WEEK_RESETS = new Date(NOON + 50 * HOUR).toISOString()

// One store file for every session, which a test can change as another session would.
function world(on: On, data: Record<string, unknown> = {}, usage: () => unknown = () => ({ startedAt: NOON, context: { window: 200_000, percent: 10 }, rateLimits: [] })) {
  on('store.get', (_$, e) => ({ value: structuredClone(data[e.key]) }) as never)
  on('store.set', (_$, e) => {
    data[e.key] = structuredClone(e.value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    delete data[e.key]
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: Object.keys(data) }) as never)
  const clock = mock.clock(on, { now: NOON })
  mock.env(on, {})
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '[]' } }) as never)
  on('fs.read', () => ({ value: '{ "version": "0.0.1" }' }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: usage() }) as never)
  on('session.measure', () => ({ changed: [] }))
  return { data, clock }
}

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const measure = ($: Engine, fiveHour: number, resetsAt = RESETS) =>
  $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: fiveHour, resetsAt },
      { kind: 'seven_day', percentUsed: 30, resetsAt: WEEK_RESETS },
    ],
    changed: ['rateLimits'],
  })

async function fiveHourShown($: Engine): Promise<string | undefined> {
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 200 } as never })
  const texts = await band.findAll({ type: 'Text' })
  await band.unmount()
  const all = texts.map(t => t.text).join(' ')
  return all.match(/5h\D*(\d+)%/)?.[1]
}

const reading = (pct: number, resetsAt = RESETS, seenAt = NOON + 60_000) => ({ kind: 'five_hour', pct, resetsAt, seenAt })

test('a reading is shared with the other sessions', async ($, on) => {
  const { data } = world(on)
  await start($)
  await measure($, 70)
  expect(data.readings).toEqual([
    { kind: 'five_hour', pct: 70, resetsAt: RESETS, seenAt: NOON },
    { kind: 'seven_day', pct: 30, resetsAt: WEEK_RESETS, seenAt: NOON },
  ])
})

test("another session's newer figure shows here within seconds", async ($, on) => {
  const { data, clock } = world(on)
  await start($)
  await measure($, 50)
  expect(await fiveHourShown($)).toBe('50')
  // Another session's reply reports 70% in the same window
  data.readings = [reading(70), { kind: 'seven_day', pct: 30, resetsAt: WEEK_RESETS, seenAt: NOON + 60_000 }]
  await clock.advance(10_000)
  expect(await fiveHourShown($)).toBe('70')
})

test("this session's older figure never pulls the shared one down", async ($, on) => {
  const { data } = world(on, { readings: [reading(70)] })
  await start($)
  // This session's last reply said 50% in the same window: 70% is the newer figure
  await measure($, 50)
  expect(await fiveHourShown($)).toBe('70')
  expect((data.readings as { pct: number }[])[0]!.pct).toBe(70)
})

test("a new window replaces the last one's figure, even when lower", async ($, on) => {
  const later = new Date(NOON + 5 * HOUR).toISOString()
  const { data } = world(on, { readings: [reading(90)] })
  await start($)
  await measure($, 4, later)
  expect(await fiveHourShown($)).toBe('4')
  expect((data.readings as { resetsAt: string }[])[0]!.resetsAt).toBe(later)
})

test('a stale reading from an ended window loses to the current one', async ($, on) => {
  const { data } = world(on, { readings: [reading(12, new Date(NOON + 4 * HOUR).toISOString())] })
  await start($)
  // This idle session still holds a figure from the window before
  await measure($, 95, new Date(NOON - HOUR / 2).toISOString())
  expect((data.readings as { pct: number }[])[0]!.pct).toBe(12)
})

test('limits kept by an older version still stand in until a reply', async ($, on) => {
  world(on, { limits: [{ kind: 'five_hour', pct: 40, resetsAt: RESETS }] })
  await start($)
  expect(await fiveHourShown($)).toBe('40')
})

test('a session whose first usage read fails still takes up the shared figures', async ($, on) => {
  let fails = true
  const { data, clock } = world(on, {}, () => {
    if (fails) throw new Error('not ready')
    return { startedAt: NOON, context: { window: 200_000, percent: 10 }, rateLimits: [] }
  })
  await start($)
  fails = false
  await measure($, 40)
  data.readings = [reading(75, RESETS, NOON + 5_000)]
  await clock.advance(10_000)
  expect(await fiveHourShown($)).toBe('75')
})
