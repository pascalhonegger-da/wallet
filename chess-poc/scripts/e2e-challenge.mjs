// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { launch, login, waitText } from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))

// The lobby is a public party nobody logs in as: players may read as it (CanReadAs), so ask the ledger through
// alice's session what the lobby sees (challenges are the only game contracts it observes).
const lobbyParty = JSON.parse(
    readFileSync(new URL('../web/public/config.json', import.meta.url))
).lobby
const lobbySees = (template) =>
    alice.page.evaluate(
        async ([lobby, template]) => {
            const { offset } = await window.chessDebug.raw(
                '/v2/state/ledger-end'
            )
            const items = await window.chessDebug.raw(
                '/v2/state/active-contracts',
                {
                    eventFormat: {
                        filtersByParty: {
                            [lobby]: {
                                cumulative: [
                                    {
                                        identifierFilter: {
                                            TemplateFilter: {
                                                value: {
                                                    templateId: `#chess-poc:Chess:${template}`,
                                                    includeCreatedEventBlob: false,
                                                },
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                        verbose: false,
                    },
                    activeAtOffset: offset,
                }
            )
            return items.length
        },
        [lobbyParty, template]
    )
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
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
    timed('bob sees challenge', () =>
        waitText(bob.page, 'alice challenges bob (alice plays Black)')
    ),
])
ok(
    'the lobby party sees the open challenge',
    (await lobbySees('Challenge')) === 1
)
ok(
    'alice can only cancel',
    (await alice.page.locator('#challenges button').allInnerTexts()).join() ===
        'Cancel'
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
])
ok(
    'the accepted challenge is gone for the lobby',
    (await lobbySees('Challenge')) === 0
)
ok('the lobby does not see the game', (await lobbySees('Game')) === 0)
ok(
    'alice has no open challenge left',
    (await alice.page.locator('#challenges li').count()) === 0
)
await b.close()
