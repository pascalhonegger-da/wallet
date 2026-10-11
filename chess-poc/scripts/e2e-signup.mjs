// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Self-service sign-up: nobody exists after `reset.sh`; players create their account in the app and see each other
// through the lobby bot. Needs an empty ledger (run right after reset.sh).
import { launch, login } from './lib/browser.mjs'

const b = await launch()
const ok = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) process.exitCode = 1
}

// alice connects for the first time (the gateway creates her authentication party) but has no chess account yet
const alice = await login(b, 'alice', { register: false })
ok(
    'a new player is offered "Create chess account"',
    await alice.page.locator('#signup').isVisible()
)
ok(
    'and sees no game UI before signing up',
    !(await alice.page.locator('#lobby').isVisible())
)
await alice.approve(() => alice.page.getByText('Create chess account').click())
await alice.page.locator('#lobby:not([hidden])').waitFor({ timeout: 30000 })
ok('after signing up alice sees the lobby', true)
ok(
    'alone, she has nobody to challenge',
    await alice.page.locator('#no-players').isVisible()
)

// bob signs up later: both see each other without reloading, the dropdowns grow
const bob = await login(b, 'bob')
await alice.page
    .locator('#opponent option', { hasText: 'bob' })
    .waitFor({ state: 'attached', timeout: 20000 })
await bob.page
    .locator('#opponent option', { hasText: 'alice' })
    .waitFor({ state: 'attached', timeout: 20000 })
ok('alice and bob see each other (introduced by the lobby bot)', true)

// carol: the third player appears for both
const carol = await login(b, 'carol')
for (const u of [alice, bob])
    await u.page
        .locator('#opponent option', { hasText: 'carol' })
        .waitFor({ state: 'attached', timeout: 20000 })
await carol.page
    .locator('#opponent option', { hasText: 'bob' })
    .waitFor({ state: 'attached', timeout: 20000 })
ok(
    'a third player shows up for everybody',
    (await carol.page.locator('#opponent option').count()) === 2
)
await b.close()
