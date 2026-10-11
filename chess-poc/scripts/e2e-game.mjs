// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { launch, login, waitText } from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
const btn = (u, text) =>
    u.page.locator('li.game').getByText(text, { exact: true })
const square = (u, sq) =>
    u.page
        .locator('li.game pre')
        .first()
        .textContent() // innerText is empty while the <details> is closed
        .then((t) => {
            const row = t.split('\n').find((l) => l.startsWith(sq[1] + ' '))
            if (!row)
                throw new Error(
                    `no row for ${sq} in text board: ${JSON.stringify(t)}`
                )
            return row.trim().split(/\s+/)[1 + 'abcdefgh'.indexOf(sq[0])]
        })

async function startGame() {
    await alice.page.locator('#opponent').selectOption({ label: 'bob' })
    await alice.page.locator('#color').selectOption('Black')
    await alice.approve(() => alice.page.locator('#challenge').click())
    await bob.page
        .getByText('Accept', { exact: true })
        .waitFor({ timeout: 20000 })
    await bob.approve(() =>
        bob.page.getByText('Accept', { exact: true }).click()
    )
    await alice.page.locator('li.game').first().waitFor({ timeout: 20000 })
    await bob.page.locator('li.game').first().waitFor({ timeout: 20000 })
}
// Every move is a real drag on the chessboard.js board (the typed-move inputs sit in a closed <details>).
async function move(u, from, to) {
    await u.page
        .locator(`li.game .square-${from} img`)
        .waitFor({ timeout: 20000 })
    await u.approve(() =>
        u.page
            .locator(`li.game .square-${from}`)
            .dragTo(u.page.locator(`li.game .square-${to}`))
    )
}

await startGame()
ok(
    'only the player to move gets move inputs',
    (await bob.page.locator('.from').count()) === 1 &&
        (await alice.page.locator('.from').count()) === 0
)

await move(bob, 'e2', 'e4')
await alice.page.waitForFunction(
    () =>
        document
            .querySelector('li.game')
            ?.textContent.includes('Black to move'),
    null,
    { timeout: 20000 }
)
ok('alice sees e4 occupied by white pawn', (await square(alice, 'e4')) === 'wP')
ok(
    'alice (black) can now move, bob cannot',
    (await alice.page.locator('.from').count()) === 1 &&
        (await bob.page.locator('.from').count()) === 0
)
await move(alice, 'e7', 'e5')
await bob.page.waitForFunction(
    () =>
        document
            .querySelector('li.game')
            ?.textContent.includes('White to move'),
    null,
    { timeout: 20000 }
)
ok(
    'bob sees e5 black pawn, e7 empty',
    (await square(bob, 'e5')) === 'bP' && (await square(bob, 'e7')) === '..'
)

// draw: offer -> decline
await alice.approve(() => btn(alice, 'Offer draw').click())
await bob.page
    .getByText('Accept draw', { exact: true })
    .waitFor({ timeout: 20000 })
ok(
    'bob sees alice offering a draw',
    (await bob.page.locator('li.game').innerText()).includes(
        'alice offers a draw'
    )
)
await bob.approve(() => btn(bob, 'Decline draw').click())
await alice.page
    .getByText('Offer draw', { exact: true })
    .waitFor({ timeout: 20000 })
ok('offer cleared after decline', true)
// draw: offer -> retract
await bob.approve(() => btn(bob, 'Offer draw').click())
await alice.page
    .getByText('Accept draw', { exact: true })
    .waitFor({ timeout: 20000 })
await bob.approve(() => btn(bob, 'Retract draw offer').click())
await alice.page
    .getByText('Offer draw', { exact: true })
    .waitFor({ timeout: 20000 })
ok('offer cleared after retract', true)
// draw: offer -> accept
await alice.approve(() => btn(alice, 'Offer draw').click())
await bob.page
    .getByText('Accept draw', { exact: true })
    .waitFor({ timeout: 20000 })
await bob.approve(() => btn(bob, 'Accept draw').click())
await waitText(alice.page, 'Drawn by draw by agreement')
await waitText(bob.page, 'Drawn by draw by agreement')
ok(
    'both see the draw result and the game is gone',
    (await alice.page.locator('li.game').count()) === 0 &&
        (await bob.page.locator('li.game').count()) === 0
)

// second game: bob resigns
await startGame()
await bob.approve(() => btn(bob, 'Resign').click())
await waitText(alice.page, 'BlackWins by resignation')
await waitText(bob.page, 'BlackWins by resignation')
ok(
    'resignation: black (alice) wins',
    (await alice.page.locator('#results li').count()) === 2
)
await b.close()
