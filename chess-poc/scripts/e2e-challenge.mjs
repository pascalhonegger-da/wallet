// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { launch, login, waitText } from './lib/browser.mjs'

const b = await launch()
const [alice, bob, lobby] = await Promise.all(
    ['alice', 'bob', 'lobby'].map((u) => login(b, u))
)

await alice.page.locator('#opponent').selectOption({ label: 'bob' })
await alice.page.locator('#color').selectOption('Black')
await alice.approve(() => alice.page.locator('#challenge').click())
await waitText(alice.page, 'alice challenges bob (alice plays Black)')

// refresh the others (polling comes in milestone 4)
await Promise.all(
    [bob, lobby].map((u) =>
        u.page.reload().then(() => u.page.getByText('New counter').waitFor())
    )
)
console.log('connected after reload?')
await waitText(lobby.page, 'alice challenges bob')
console.log('lobby sees the open challenge')
console.log(
    'lobby offered buttons:',
    await lobby.page.locator('#challenges button').count()
)

await bob.approve(() => bob.page.getByText('Accept', { exact: true }).click())
await waitText(bob.page, 'bob (white) vs alice (black)')
console.log('bob sees the game: bob is white')
await alice.page.reload()
await alice.page.getByText('New counter').waitFor()
await waitText(alice.page, 'bob (white) vs alice (black)')
await lobby.page.reload()
await lobby.page.getByText('New counter').waitFor()
console.log(
    'lobby games:',
    await lobby.page.locator('#games li').count(),
    '| lobby challenges:',
    await lobby.page.locator('#challenges li').count()
)
await b.close()
