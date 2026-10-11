// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { chromium } from '../../../node_modules/playwright/index.mjs'

export const launch = () => chromium.launch()

/** Open the dApp as `user` (already onboarded): connect through the gateway popup and select the auth party. */
export async function login(browser, user) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('dialog', (d) => {
        console.log(`[${user}] DIALOG:`, d.message())
        d.dismiss()
    })
    const popup = ctx.waitForEvent('page', { timeout: 20000 })
    await page.goto('http://localhost:5173/')
    await page.getByText('Connect wallet').click()
    const picker = await popup
    await picker.getByText('Local Gateway').click()
    const gw = await until(page, () =>
        ctx.pages().find((x) => x.url().includes(':3030'))
    )
    await gw.locator('input').first().fill(user)
    await gw.getByText('Connect', { exact: true }).click()
    await gw.getByText('Select', { exact: true }).click()
    await page.getByText('New counter').waitFor()
    return {
        user,
        page,
        /** Run `action` (which triggers a submission) and approve it in the gateway's approval page. */
        async approve(action) {
            await action()
            const ap = await until(page, () =>
                ctx.pages().find((x) => x.url().includes('/approve'))
            )
            await ap.getByText('Approve', { exact: true }).click()
        },
    }
}

async function until(page, f, tries = 150) {
    for (let i = 0; i < tries; i++) {
        const v = f()
        if (v) return v
        await page.waitForTimeout(200)
    }
    throw new Error('timed out waiting for popup')
}

export const waitText = (page, text, opts = {}) =>
    page
        .getByText(text)
        .first()
        .waitFor({ timeout: 20000, ...opts })
