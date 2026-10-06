import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOON = Date.parse('2026-10-05T12:00:00Z')

const run = async ($: Engine, args: string) => (await $.command.run({ command: 'usage-hud', args } as never)).text
const PANE = { plugin: 'usage-hud', component: 'Pane', requestId: 'shop', props: { bodyColumns: 100 } as never } as const

test('shop, and wear, buy or remove with no item, open the shop pane', async ($, on) => {
  mock.store(on, { progress: { xp: 1000, coins: 200 } })
  mock.clock(on, { now: NOON })
  on('command.run', () => ({ text: '' }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  for (const args of ['shop', 'wear', 'buy', 'remove']) expect(await run($, args)).toMatch(/Opened Clawd's shop/)
  expect(opened).toEqual(['shop', 'shop', 'shop', 'shop'])
  // The text list is still there, and stands in where the pane can't be drawn.
  expect(await run($, 'shop list')).toMatch(/Head: beanie free at level 5 \(wearing\)/)
  expect(await run($, 'wear scarf')).toBe('Clawd is wearing the scarf.')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pressing items in the ${surface} pane buys, wears and takes off`, async ($, on) => {
    mock.store(on, { progress: { xp: 1000, coins: 200 } })
    mock.clock(on, { now: NOON })
    on('command.run', () => ({ text: '' }))
    on('ui.toast', () => ({ value: undefined }) as never)
    const ui = await $.ui.mount({ ...PANE, surface })

    // Level 5 wears the beanie; the cap is for sale; the crown needs level 20.
    expect(await ui.find({ key: 'item:beanie', type: 'Button' })).toBeDefined()
    expect(await ui.find({ key: 'item:crown', type: 'Button' })).toBeUndefined()
    await ui.press({ key: 'item:cap' })
    expect(await run($, 'stats')).toMatch(/Coins: 100 · wearing: cap, scarf/)

    await ui.press({ key: 'item:cap' }) // now worn: a press takes it off
    expect(await run($, 'stats')).toMatch(/wearing: scarf/)
    await ui.press({ key: 'item:beanie' })
    expect(await run($, 'stats')).toMatch(/wearing: beanie, scarf/)
    await ui.press({ key: 'none' })
    expect(await run($, 'stats')).toMatch(/wearing: nothing/)
    await ui.unmount()
  })
}

test('the desktop shop shows Clawd trying each item on', async ($, on) => {
  mock.store(on, { progress: { xp: 1000, coins: 200 } })
  mock.clock(on, { now: NOON })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg', alt: 'Clawd in the crown' } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Level 20' })).toBeDefined()
  await ui.unmount()
})

for (const [columns, direction] of [[38, 'column'], [100, 'row']] as const) {
  test(`a ${columns}-column desktop shop lays its header out as a ${direction}`, async ($, on) => {
    mock.store(on, { progress: { xp: 1000, coins: 200 } })
    mock.clock(on, { now: NOON })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { bodyColumns: columns } as never })
    const header = ((await ui.drawn()) as unknown as { children: { props: Record<string, unknown> }[] }).children[0]
    expect(header.props.flexDirection).toBe(direction)
    expect(await ui.find({ key: 'none', type: 'Button' })).toBeDefined()
    await ui.unmount()
  })
}

test('a backdrop is bought like an item and drawn behind the crab on the band', async ($, on) => {
  mock.store(on, { progress: { xp: 5000, coins: 1000 } })
  mock.clock(on, { now: NOON })
  on('command.run', () => ({ text: '' }))
  on('session.measure', () => ({ changed: [] }))

  expect(await run($, 'buy space')).toBe('Bought the space backdrop for 1,000 coins, and it\'s up behind Clawd. 0 coins left.')
  expect(await run($, 'buy australia')).toBe('The Australia backdrop costs 600 coins and you have 0.')
  await $.session.measure({ context: { window: 200_000, percent: 10 }, rateLimits: [], changed: [] })
  const band = await $.ui.mount({ plugin: 'usage-hud', surface: 'desktop', component: 'AbovePrompt', props: { bodyColumns: 120 } as never })
  const svg = (await band.find({ type: 'Svg' })) as unknown as { props: { source: string } }
  expect(svg.props.source).toContain('#1b1d2b') // the space sky
  await band.unmount()

  expect(await run($, 'remove backdrop')).toBe('Took off the space backdrop.')
  expect(await run($, 'wear space')).toBe("Clawd's backdrop is now space.")
})
