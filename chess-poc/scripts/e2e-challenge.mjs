// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { launch, login, waitText } from './lib/browser.mjs'

const b = await launch()
const [alice, bob, lobby] = await Promise.all(
    ['alice', 'bob', 'lobby'].map((u) => login(b, u))
)
const timed = async (label, f) => {
    const t = Date.now()
    await f()
    console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`)
}

// Polling must not reset a form the user is filling in.
await bob.page.locator('#color').selectOption('Black')

await alice.page.locator('#opponent').selectOption({ label: 'bob' })
await alice.page.locator('#color').selectOption('Black')
await alice.approve(() => alice.page.locator('#challenge').click())

await Promise.all([
    timed('lobby sees challenge', () =>
        waitText(lobby.page, 'alice challenges bob (alice plays Black)')
    ),
    timed('bob sees challenge', () =>
        waitText(bob.page, 'alice challenges bob (alice plays Black)')
    ),
])
console.log(
    'lobby buttons:',
    await lobby.page.locator('#challenges button').count(),
    '| alice buttons:',
    await alice.page.locator('#challenges button').allInnerTexts()
)
console.log(
    'bob form kept across polls:',
    await bob.page.locator('#color').inputValue()
)

await bob.approve(() => bob.page.getByText('Accept', { exact: true }).click())
await Promise.all([
    timed('bob sees game', () =>
        waitText(bob.page, 'bob (white) vs alice (black)')
    ),
    timed('alice sees game', () =>
        waitText(alice.page, 'bob (white) vs alice (black)')
    ),
    timed('challenge vanishes for lobby', () =>
        lobby.page.waitForFunction(
            () => document.querySelectorAll('#challenges li').length === 0,
            null,
            { timeout: 20000 }
        )
    ),
])
await lobby.page.waitForTimeout(5000)
console.log(
    'lobby games:',
    await lobby.page.locator('#games li').count(),
    '| alice challenges:',
    await alice.page.locator('#challenges li').count()
)
await b.close()
