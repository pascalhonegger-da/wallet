// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { launch, login } from './lib/browser.mjs'

const b = await launch()
const u = await login(b, process.argv[2] ?? 'alice')
const p = u.page
const state = () =>
    p
        .locator('li.counter')
        .evaluateAll((els) => els.map((e) => parseInt(e.textContent)))
const sum = (xs) => xs.reduce((a, c) => a + c, 0)

const before = await state()
await u.approve(() => p.getByText('New counter').click())
await p.waitForFunction(
    (n) => document.querySelectorAll('li.counter').length === n,
    before.length + 1,
    { timeout: 20000 }
)
const mid = await state()
console.log('create:', before.length, '->', mid.length, 'counters')
await u.approve(() => p.locator('li.counter button').first().click())
await p.waitForFunction(
    (t) =>
        [...document.querySelectorAll('li.counter')].reduce(
            (a, e) => a + parseInt(e.textContent),
            0
        ) === t,
    sum(mid) + 1,
    { timeout: 20000 }
)
console.log('increment: total', sum(mid), '->', sum(await state()))
await b.close()
