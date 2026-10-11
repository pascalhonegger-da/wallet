// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { chromium } from '../../node_modules/playwright/index.mjs'
const [user, shot] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage()
p.on(
    'response',
    (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url())
)
await p.goto('http://localhost:3030/')
await p.locator('input').first().fill(user)
await p.getByText('Connect', { exact: true }).click()
await p.waitForURL('**/onboarding/**')
await p.getByPlaceholder('Enter the name of your wallet?').fill(user)
await p.locator('select').first().selectOption({ index: 1 }) // wallet-kernel
await p.getByText('Create party', { exact: true }).click()
await p.waitForTimeout(6000)
console.log(user, '->', p.url())
if (shot) await p.screenshot({ path: `${shot}.png` })
await b.close()
