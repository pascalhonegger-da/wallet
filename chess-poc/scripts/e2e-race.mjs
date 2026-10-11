// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { launch, login } from './lib/browser.mjs'

const b = await launch()
const [alice, bob] = await Promise.all(['alice', 'bob'].map((u) => login(b, u)))
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}
const message = (u) => u.page.locator('#message')
const challenge = async () => {
    await alice.page.locator('#opponent').selectOption({ label: 'bob' })
    await alice.page.locator('#color').selectOption('Black') // so bob is White and moves first
    await alice.approve(() => alice.page.locator('#challenge').click())
    await bob.page
        .getByText('Accept', { exact: true })
        .waitFor({ timeout: 20000 })
}

// 1. bob clicks Accept on a challenge alice has already cancelled (his view is stale).
await challenge()
await bob.page.evaluate(() => window.__chess.pause())
await alice.approve(() =>
    alice.page.getByText('Cancel', { exact: true }).click()
)
await alice.page
    .locator('#challenges li')
    .first()
    .waitFor({ state: 'detached', timeout: 20000 })
await bob.page.getByText('Accept', { exact: true }).click()
await message(bob).filter({ hasText: /./ }).waitFor({ timeout: 30000 })
const m1 = await message(bob).innerText()
console.log('   message:', m1)
ok('stale accept shows a friendly "too late" message', /Too late/.test(m1))
await bob.page.evaluate(() => window.__chess.resume())
await bob.page
    .locator('#challenges li')
    .first()
    .waitFor({ state: 'detached', timeout: 20000 })
ok("bob's view refreshed: challenge gone", true)

// 2. double click on Accept submits exactly once.
await challenge()
await bob.page.getByText('Accept', { exact: true }).dblclick()
await bob.page.waitForTimeout(500)
const approvals = () =>
    bob.page
        .context()
        .pages()
        .filter((p) => p.url().includes('/approve')).length
ok('one approval page after a double click', approvals() === 1)
await bob.page
    .context()
    .pages()
    .find((p) => p.url().includes('/approve'))
    .getByText('Approve', { exact: true })
    .click()
await bob.page.locator('li.game').first().waitFor({ timeout: 20000 })
await alice.page.locator('li.game').first().waitFor({ timeout: 20000 })
ok(
    'exactly one game created',
    (await bob.page.locator('li.game').count()) === 1
)

// 3. bob drags a piece in a game alice has just resigned (stale view).
await bob.page.locator('li.game .square-e2 img').waitFor({ timeout: 20000 })
await bob.page.evaluate(() => window.__chess.pause())
await alice.approve(() =>
    alice.page.getByText('Resign', { exact: true }).click()
)
await alice.page.locator('#results li').first().waitFor({ timeout: 20000 })
await bob.page
    .locator('li.game .square-e2')
    .dragTo(bob.page.locator('li.game .square-e4'))
await message(bob).filter({ hasText: /./ }).waitFor({ timeout: 30000 })
const m2 = await message(bob).innerText()
console.log('   message:', m2)
ok('stale move shows a friendly "too late" message', /Too late/.test(m2))
await b.close()
