// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    dragMove,
    dragSquares,
    launch,
    login,
    square,
    startGame as start,
    waitText,
} from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
const btn = (u, text) =>
    u.page.locator('li.game').getByText(text, { exact: true })
const move = dragMove
const approvalPages = (u) =>
    u.page
        .context()
        .pages()
        .filter((p) => p.url().includes('/approve')).length

await start(alice, bob)
ok(
    'only the player to move gets move inputs',
    (await bob.page.locator('.cg-wrap.manipulable').count()) === 1 &&
        (await alice.page.locator('.cg-wrap.manipulable').count()) === 0
)

// An illegal drag (pawn three squares) is not even allowed by the board: nothing submitted, board unchanged.
const approvalsBefore = approvalPages(bob)
await dragSquares(bob.page, 'e2', 'e5')
await bob.page.waitForTimeout(1500)
ok(
    'illegal move: no new approval page was opened',
    approvalPages(bob) <= approvalsBefore
)
ok(
    'illegal move: the board is unchanged',
    (await square(bob, 'e5')) === '..' && (await square(bob, 'e2')) === 'wP'
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
    (await alice.page.locator('.cg-wrap.manipulable').count()) === 1 &&
        (await bob.page.locator('.cg-wrap.manipulable').count()) === 0
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

// the move list is read from the ledger's exercised Move events, not stored in the contract
await bob.page.waitForFunction(
    () =>
        document.querySelector('li.game .movelist')?.textContent === '1. e4 e5',
    null,
    { timeout: 20000 }
)
ok('move history for an active game: 1. e4 e5', true)

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

// second game: fool's mate (a capture-free mate in four plies)
await start(alice, bob)
await move(bob, 'f2', 'f3')
await move(alice, 'e7', 'e5')
await move(bob, 'g2', 'g4')
ok(
    'alice is not told the position is special before the mate',
    (await alice.page.locator('li.game .note').innerText()) === ''
)
await move(alice, 'd8', 'h4')
// the ledger ends the game by itself: checkmate is a result, no resignation needed
await waitText(bob.page, 'BlackWins by checkmate')
await waitText(alice.page, 'BlackWins by checkmate')
await waitText(alice.page, '1. f3 e5 2. g4 Qh4#')
ok('move history for a finished game: 1. f3 e5 2. g4 Qh4#', true)
ok(
    'checkmate ends the game by itself: black (alice) wins',
    (await alice.page.locator('#results li').count()) === 2 &&
        (await alice.page.locator('li.game').count()) === 0
)

// third game: castle short by dragging the king two squares (the ledger moves the rook as well)
await start(alice, bob)
for (const [u, from, to] of [
    [bob, 'e2', 'e4'],
    [alice, 'e7', 'e5'],
    [bob, 'g1', 'f3'],
    [alice, 'b8', 'c6'],
    [bob, 'f1', 'c4'],
    [alice, 'g8', 'f6'],
])
    await move(u, from, to)
await move(bob, 'e1', 'g1')
await bob.page.waitForFunction(
    () =>
        document
            .querySelector('li.game')
            ?.textContent.includes('Black to move'),
    null,
    { timeout: 20000 }
)
ok(
    'castling: king on g1 and rook on f1',
    (await square(bob, 'g1')) === 'wK' && (await square(bob, 'f1')) === 'wR'
)
ok(
    'castling: e1 and h1 are empty',
    (await square(bob, 'e1')) === '..' && (await square(bob, 'h1')) === '..'
)
await bob.approve(() => btn(bob, 'Resign').click())
await waitText(alice.page, 'BlackWins by resignation')
ok(
    'resignation still works: three results',
    (await alice.page.locator('#results li').count()) === 3
)
await b.close()
