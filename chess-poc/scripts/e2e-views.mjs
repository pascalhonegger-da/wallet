// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Looking at earlier positions, opening finished games, and the console debug helpers. Needs an empty ledger.
import { dragMove, launch, login, startGame, waitText } from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
// is there a piece of this kind on the square? (squares are 50px in a 400px board, white at the bottom)
const piece = async (u, kind, sq, black = false) => {
    await u.page.waitForTimeout(400) // pieces slide for a moment
    const f = 'abcdefgh'.indexOf(sq[0])
    const r = Number(sq[1]) - 1
    const [x, y] = black ? [(7 - f) * 50, r * 50] : [f * 50, (7 - r) * 50]
    return u.page
        .locator(`li.game piece.${kind}[style*="translate(${x}px, ${y}px)"]`)
        .count()
        .then((n) => n === 1)
}

await startGame(alice, bob)
await dragMove(bob, 'e2', 'e4')
await dragMove(alice, 'e7', 'e5')
await dragMove(bob, 'g1', 'f3')
await waitText(bob.page, '1. e4 e5 2. Nf3')
ok(
    'the latest position is interactive',
    (await bob.page.locator('li.game .cg-wrap.manipulable').count()) ===
        0 /* black to move */
)
await alice.page
    .locator('li.game .movelist')
    .getByText('1. e4 e5 2. Nf3')
    .waitFor()
ok(
    'alice (to move) can move on the latest position',
    (await alice.page.locator('li.game .cg-wrap.manipulable').count()) === 1
)

// click the first move: the board shows the position after 1. e4 and is view-only
await alice.page.locator('li.game .mv[data-ply="1"]').click()
ok(
    'after 1. e4 the pawn is on e4',
    await piece(alice, 'white.pawn', 'e4', true)
)
ok(
    'after 1. e4 black has not moved e5',
    !(await piece(alice, 'black.pawn', 'e5', true))
)
ok(
    'the shown move is highlighted',
    (await alice.page.locator('li.game .mv.sel').innerText()) === 'e4'
)
ok(
    'no interaction while looking at the past',
    (await alice.page.locator('li.game .cg-wrap.past').count()) === 1
)
await alice.page.locator('li.game button[data-nav="first"]').click()
ok('start position: pawn on e2', await piece(alice, 'white.pawn', 'e2', true))
await alice.page.locator('li.game button[data-nav="next"]').click()
ok('next goes to 1. e4', await piece(alice, 'white.pawn', 'e4', true))
await alice.page.locator('li.game button[data-nav="last"]').click()
ok(
    'latest: knight on f3 and interactive again',
    (await piece(alice, 'white.knight', 'f3', true)) &&
        (await alice.page.locator('li.game .cg-wrap.past').count()) === 0
)

// a draw offer replaces the game contract: the history must survive it
await alice.approve(() =>
    alice.page
        .locator('li.game')
        .getByText('Offer draw', { exact: true })
        .click()
)
await bob.page
    .getByText('Accept draw', { exact: true })
    .waitFor({ timeout: 20000 })
await bob.page
    .locator('li.game .movelist')
    .getByText('1. e4 e5 2. Nf3')
    .waitFor({ timeout: 20000 })
ok('the move list survives a draw offer', true)

// a game ended by resignation keeps its moves and can be opened
await bob.approve(() =>
    bob.page.locator('li.game').getByText('Resign', { exact: true }).click()
)
await waitText(alice.page, 'BlackWins by resignation')
const res = alice.page.locator('#results li.result')
await res.getByText('Open', { exact: true }).click()
await res
    .locator('.movelist')
    .getByText('1. e4 e5 2. Nf3')
    .waitFor({ timeout: 20000 })
ok('an opened past game shows its moves', true)
await res.locator('button[data-nav="first"]').click()
await alice.page.waitForTimeout(600)
console.log(
    '   pieces:',
    await res.locator('.board piece:not(.ghost)').count(),
    'sel:',
    await res.locator('.mv.sel').count()
)
ok(
    'a past game can be stepped through',
    (await res.locator('.mv.sel').count()) === 0 &&
        (await res.locator('.board piece:not(.ghost)').count()) === 32
)
await res.locator('.mv[data-ply="2"]').click()
ok(
    'clicking a move highlights it',
    (await res.locator('.mv.sel').innerText()) === 'e5'
)

// the debug helpers
const contracts = await alice.page.evaluate(() => window.chessDebug.contracts())
ok(
    'chessDebug.contracts() lists the result',
    contracts.some((c) => c.template === 'GameResult')
)
const events = await alice.page.evaluate(() => window.chessDebug.events())
console.log(
    '   events:',
    events.length,
    JSON.stringify(events[events.length - 1]).slice(0, 300)
)
ok(
    'chessDebug.events() lists creations and choices',
    events.some((e) => e.event === 'Created') &&
        events.some((e) => e.choice === 'Move')
)
await b.close()
