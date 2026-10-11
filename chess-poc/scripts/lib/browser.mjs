// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { chromium } from '../../../node_modules/playwright/index.mjs'

export const launch = () => chromium.launch()

/** Run the wallet connect flow: `trigger` starts it (Connect wallet / Reconnect), then pick the local gateway,
 * log in as `user` and select the authentication party. */
export async function connectFlow(ctx, page, user, trigger) {
    const popup = ctx.waitForEvent('page', { timeout: 20000 })
    await trigger()
    const picker = await popup
    await picker.getByText('Local Gateway').click()
    const gw = await until(
        page,
        () => ctx.pages().find((x) => x.url().includes(':3030/login')),
        'the gateway login popup'
    )
    await gw.locator('input').first().fill(user)
    await gw.getByText('Connect', { exact: true }).click()
    await gw.getByText('Select', { exact: true }).click()
}

/** Open the dApp as `user` (already onboarded): connect through the gateway popup and select the auth party. */
export async function login(browser, user) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('dialog', (d) => {
        console.log(`[${user}] DIALOG:`, d.message())
        d.dismiss()
    })
    await page.goto('http://localhost:5173/')
    await connectFlow(ctx, page, user, () =>
        page.getByText('Connect wallet').click()
    )
    await page.getByText('New counter').waitFor()
    return {
        user,
        page,
        ctx,
        /** Run `action` (which triggers a submission) and approve it in the gateway's approval page. */
        async approve(action) {
            await action()
            const ap = await until(
                page,
                () => ctx.pages().find((x) => x.url().includes('/approve')),
                `the approval page (${user})`
            )
            await ap.getByText('Approve', { exact: true }).click()
        },
        /** Like approve, but click Reject in the approval page. */
        async reject(action) {
            await action()
            const ap = await until(
                page,
                () => ctx.pages().find((x) => x.url().includes('/approve')),
                `the approval page (${user})`
            )
            // the wallet asks "Reject pending activity ...?" in a browser confirm() dialog
            ap.on('dialog', (d) => d.accept())
            await ap.getByText('Reject', { exact: true }).click()
        },
        /** Like approve, but close the approval window without deciding. */
        async abandon(action) {
            await action()
            const ap = await until(
                page,
                () => ctx.pages().find((x) => x.url().includes('/approve')),
                `the approval page (${user})`
            )
            await ap.close()
        },
    }
}

async function until(page, f, what, tries = 150) {
    for (let i = 0; i < tries; i++) {
        const v = f()
        if (v) return v
        await page.waitForTimeout(200)
    }
    throw new Error(`timed out waiting for ${what}`)
}

export const waitText = (page, text, opts = {}) =>
    page
        .getByText(text)
        .first()
        .waitFor({ timeout: 20000, ...opts })

/** Drag a piece on the chessboard.js board as `u` (alice is Black, bob is White in the e2e games). Waits until
 * the page shows it is the player's turn: the other side's move arrives by polling. */
export async function dragMove(u, from, to) {
    const colour = u.user === 'bob' ? 'White' : 'Black'
    await u.page.waitForFunction(
        (t) => document.querySelector('li.game')?.textContent.includes(t),
        `${colour} to move`,
        { timeout: 20000 }
    )
    await u.page
        .locator(`li.game .square-${from} img`)
        .waitFor({ timeout: 20000 })
    await u.approve(() =>
        u.page
            .locator(`li.game .square-${from}`)
            .dragTo(u.page.locator(`li.game .square-${to}`))
    )
}

/** Text of the page's message line, waiting until there is one. */
export async function message(u, timeout = 30000) {
    await u.page
        .locator('#message')
        .filter({ hasText: /./ })
        .waitFor({ timeout })
    return u.page.locator('#message').innerText()
}

/** alice challenges bob (alice plays Black) and bob accepts; both pages show the game when this returns. */
export async function startGame(alice, bob) {
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

/** The piece on a square according to the game's text board ('..' if empty). */
export async function square(u, sq) {
    const t = await u.page.locator('li.game pre').first().textContent() // innerText is empty while <details> is closed
    const row = t.split('\n').find((l) => l.startsWith(sq[1] + ' '))
    if (!row) throw new Error(`no row for ${sq} in ${JSON.stringify(t)}`)
    return row.trim().split(/\s+/)[1 + 'abcdefgh'.indexOf(sq[0])]
}
