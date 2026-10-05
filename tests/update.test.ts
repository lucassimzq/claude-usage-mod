import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const NOON = Date.parse('2026-10-05T12:00:00Z')
const HOUR = 3_600_000

const start = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const measure = ($: Engine) =>
  $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOON + 24 * HOUR).toISOString() }],
    changed: [],
  })

const run = async ($: Engine, args: string) => (await $.command.run({ command: 'usage-hud', args } as never)).text

// GitHub's tag list, counting the calls; plugin.json says 0.0.1.
function github(on: On, tags: string[]) {
  const calls = { count: 0 }
  on('http.fetch', () => {
    calls.count += 1
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(tags.map(name => ({ name }))) } }
  })
  return calls
}

// git, answering each subcommand by name.
function git(on: On, answers: Record<string, number> = {}) {
  const ran: string[] = []
  on('process.run', (_$, e) => {
    const sub = e.argv[3]!
    ran.push(e.argv.slice(3).join(' '))
    const exitCode = answers[sub] ?? 0
    return { value: { exitCode, stdout: '', stderr: exitCode ? `fatal: ${sub} failed` : '' } } as never
  })
  return ran
}

function world(on: On, store?: Record<string, unknown>) {
  mock.store(on, store)
  const clock = mock.clock(on, { now: NOON })
  mock.env(on, {})
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('/.claude-plugin/plugin.json') ? '{ "version": "0.0.1" }' : '' }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOON, context: { window: 200_000, percent: 10 }, rateLimits: [] } }) as never)
  on('session.measure', () => ({ changed: [] }))
  on('command.run', () => ({ text: '' }))
  return clock
}

test('a newer release tag puts an update button on the band', async ($, on) => {
  world(on)
  github(on, ['v0.0.1', 'v0.0.2', 'v0.1.0-beta', 'nightly'])
  await start($)
  await measure($)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const band = await $.ui.mount({ plugin: 'usage-hud', surface, component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
    expect(await band.find({ type: 'Button', key: 'update' })).toBeDefined()
    await band.unmount()
  }
})

test('no button when the newest tag is the running version', async ($, on) => {
  world(on)
  github(on, ['v0.0.1'])
  await start($)
  await measure($)
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  expect(await band.find({ type: 'Button', key: 'update' })).toBeUndefined()
  await band.unmount()
  expect(await run($, 'update')).toBe('usage-hud is up to date (v0.0.1).')
})

test('GitHub is asked at most every six hours, across sessions', async ($, on) => {
  world(on, { latest: { tag: 'v0.0.1', checkedAt: NOON - HOUR } })
  const calls = github(on, ['v0.0.2'])
  git(on)
  await start($)
  expect(calls.count).toBe(0)
  // /usage-hud update always asks
  await run($, 'update')
  expect(calls.count).toBe(1)
})

test('pressing update fast-forwards the clone to the release tag', async ($, on) => {
  world(on)
  github(on, ['v0.0.2'])
  const ran = git(on)
  await start($)
  await measure($)
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  await band.press({ key: 'update' })
  expect(ran).toEqual(['rev-parse --is-inside-work-tree', 'fetch --tags --quiet origin', 'merge --ff-only --quiet refs/tags/v0.0.2'])
  expect(await band.find({ type: 'Text', text: /updating…/ })).toBeDefined()
  await band.unmount()
})

test('a session that did not reload the mod says it needs a restart', async ($, on) => {
  const clock = world(on)
  github(on, ['v0.0.2'])
  git(on)
  await start($)
  await measure($)
  expect(await run($, 'update')).toBe('Installing usage-hud v0.0.2…')
  // Nothing reloaded the module within a few seconds
  await clock.set(NOON + 10_000)
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  expect(await band.find({ type: 'Text', text: /restart for v0.0.2/ })).toBeDefined()
  await band.unmount()
})

test('a failed git step leaves the button and says how to update by hand', async ($, on) => {
  world(on)
  github(on, ['v0.0.2'])
  git(on, { merge: 128 })
  await start($)
  expect(await run($, 'update')).toMatch(/^Couldn't update usage-hud: fatal: merge failed\. Run `git -C .* pull` to update by hand\.$/)
})

test('a copy that is not a git clone is told to update the way it was installed', async ($, on) => {
  world(on)
  github(on, ['v0.0.2'])
  const ran = git(on, { 'rev-parse': 128 })
  await start($)
  expect(await run($, 'update')).toMatch(/isn't a git clone/)
  expect(ran).toHaveLength(1)
})

test('the reloaded mod says once that it updated', async ($, on) => {
  world(on, { installing: 'v0.0.1' })
  github(on, ['v0.0.1'])
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  await start($)
  await start($)
  expect(toasts).toEqual(['Clawd updated himself to v0.0.1'])
})
