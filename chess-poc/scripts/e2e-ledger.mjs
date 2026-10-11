// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    launch,
    login,
    dragMove,
    dragSquares,
    message,
    startGame,
    square,
} from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
const approvalPages = (u) =>
    u.page
        .context()
        .pages()
        .filter((p) => p.url().includes('/approve')).length
const busy = (u) =>
    u.page.evaluate(() => document.body.className.includes('busy'))
const resign = async (u, other) => {
    await u.approve(() =>
        u.page.locator('li.game').getByText('Resign', { exact: true }).click()
    )
    await other.page
        .locator('li.game')
        .waitFor({ state: 'detached', timeout: 20000 })
}

// --- game 1: a cheating client, approvals that go wrong, en passant
await startGame(alice, bob)

// A modified client skips the UI's rule check; the ledger must still refuse. The failure happens while the
// transaction is prepared, so no approval window opens.
const before = approvalPages(bob)
await bob.page.evaluate(() => window.__chess.submitSan('e5'))
const illegal = await message(bob)
console.log('   bob, illegal move:', illegal)
ok(
    'ledger rejects an illegal move from a cheating client',
    /illegal move/i.test(illegal)
)
ok('no approval window for it', approvalPages(bob) === before)
await alice.page.evaluate(() => window.__chess.submitSan('e5'))
const early = await message(alice)
console.log('   alice, out of turn:', early)
ok('ledger rejects a move out of turn', /not your turn/i.test(early))

// Rejecting in the wallet: the move is not made and the page is usable again.
await bob.reject(() => dragSquares(bob.page, 'e2', 'e4'))
const rejected = await message(bob)
console.log('   rejected:', rejected)
ok('rejecting shows a message', /rejected/i.test(rejected))
ok(
    'rejecting leaves the board unchanged and the page usable',
    (await square(bob, 'e4')) === '..' && !(await busy(bob))
)

// Closing the approval window without deciding: stop waiting after the timeout instead of hanging.
await bob.page.evaluate(() => window.__chess.setApprovalTimeout(4000))
await bob.abandon(() => dragSquares(bob.page, 'e2', 'e4'))
// depending on timing the SDK reports the closed window itself (rejected) or we give up (no answer)
const abandoned = await message(bob, 20000)
console.log('   abandoned:', abandoned)
ok(
    'an abandoned approval ends with a message',
    /No answer from the wallet|rejected/.test(abandoned)
)
await bob.page.waitForTimeout(5000)
ok('and the page is usable again', !(await busy(bob)))
await bob.page.evaluate(() => window.__chess.setApprovalTimeout(90000))

await bob.page.reload()
await bob.page.locator('li.game').first().waitFor({ timeout: 20000 })

// En passant, by dragging: the ledger and chess.js must agree that exd6 is legal.
await dragMove(bob, 'e2', 'e4')
await dragMove(alice, 'a7', 'a6')
await dragMove(bob, 'e4', 'e5')
await dragMove(alice, 'd7', 'd5')
await dragMove(bob, 'e5', 'd6')
await bob.page.waitForFunction(
    () =>
        document
            .querySelector('li.game')
            ?.textContent.includes('Black to move'),
    null,
    { timeout: 20000 }
)
ok(
    'en passant: the capturing pawn is on d6',
    (await square(bob, 'd6')) === 'wP'
)
ok(
    'en passant: the captured pawn on d5 is gone',
    (await square(bob, 'd5')) === '..'
)
await resign(bob, alice)

// --- game 2: check handling
await startGame(alice, bob)
for (const [u, from, to] of [
    [bob, 'e2', 'e4'],
    [alice, 'e7', 'e5'],
    [bob, 'd1', 'h5'],
    [alice, 'b8', 'c6'],
    [bob, 'h5', 'e5'],
])
    await dragMove(u, from, to)
await alice.page
    .locator('li.game .note')
    .filter({ hasText: 'Black is in check.' })
    .waitFor({ timeout: 20000 })
ok('the check is announced', true)
const approvalsBefore = approvalPages(alice)
await dragSquares(alice.page, 'a7', 'a6')
await alice.page.waitForTimeout(1500)
ok(
    'a move that ignores the check is not allowed by the board (nothing submitted)',
    approvalPages(alice) === approvalsBefore &&
        (await square(alice, 'a6')) === '..'
)
await dragMove(alice, 'c6', 'e5') // the knight takes the checking queen
await bob.page
    .locator('li.game')
    .filter({ hasText: 'White to move' })
    .waitFor({ timeout: 20000 })
ok(
    'capturing the checker is accepted and the note goes away',
    (await alice.page.locator('li.game .note').innerText()) === ''
)
await resign(alice, bob)

await b.close()
