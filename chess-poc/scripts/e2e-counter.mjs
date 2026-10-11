// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { chromium } from '../../node_modules/playwright/index.mjs'
const user = process.argv[2] ?? 'alice'
const b = await chromium.launch()
const ctx = await b.newContext()
const p = await ctx.newPage()
p.on('dialog', (d) => {
    console.log('DIALOG:', d.message())
    d.dismiss()
})
let pk = ctx.waitForEvent('page', { timeout: 20000 })
await p.goto('http://localhost:5173/')
await p.getByText('Connect wallet').click()
const picker = await pk
await picker.getByText('Local Gateway').click()
const gw = await (async () => {
    for (;;) {
        const g = ctx.pages().find((x) => x.url().includes(':3030'))
        if (g) return g
        await p.waitForTimeout(200)
    }
})()
await gw.locator('input').first().fill(user)
await gw.getByText('Connect', { exact: true }).click()
await gw.getByText('Select', { exact: true }).click()
await p.getByText('New counter').waitFor()
console.log('connected:', (await p.locator('code').innerText()).slice(0, 30))

async function approve(action) {
    await action()
    let ap
    for (let i = 0; i < 100 && !ap; i++) {
        ap = ctx.pages().find((x) => x.url().includes('/approve'))
        if (!ap) await p.waitForTimeout(200)
    }
    if (!ap) throw new Error('no approval page appeared')
    await ap.getByText('Approve', { exact: true }).click()
}
const items = () => p.locator('li').count()
await approve(() => p.getByText('New counter').click())
await p.locator('li').first().waitFor({ timeout: 20000 })
console.log(
    'counters after create:',
    await items(),
    '->',
    await p.locator('li').first().innerText()
)
await approve(() => p.locator('li button').first().click())
await p.waitForFunction(
    () => document.querySelector('li')?.textContent?.startsWith('1'),
    null,
    { timeout: 20000 }
)
console.log('after +1:', await p.locator('li').first().innerText())
await b.close()
