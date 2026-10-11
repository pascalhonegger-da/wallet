// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { chromium } from '../../../node_modules/playwright/index.mjs'

/** The chess app: the local stack by default, or e.g. CHESS_URL=http://localhost:8080 for the Docker image. */
export const APP_URL = process.env.CHESS_URL ?? 'http://localhost:5173/'

export const launch = () => chromium.launch()

/** Run the wallet connect flow: `trigger` starts it (Connect wallet / Reconnect), then pick the local gateway,
 * log in as `user` and select the authentication party. */
export async function connectFlow(ctx, page, user, trigger) {
    const popup = ctx.waitForEvent('page', { timeout: 20000 })
    await trigger()
    const picker = await popup
    await picker.getByText('Chess Wallet Gateway').click()
    const gw = await until(
        page,
        () => ctx.pages().find((x) => /\/login\/?(\?|$)/.test(x.url())),
        'the gateway login popup'
    )
    await gw.locator('input').first().fill(user)
    await gw.getByText('Connect', { exact: true }).click()
    // a first-time user has to create their authentication party (the gateway's onboarding page) before selecting it
    const nameInput = gw.getByPlaceholder('Enter the name of your wallet?')
    const select = gw.getByText('Select', { exact: true })
    const first = await Promise.race([
        nameInput.waitFor({ timeout: 20000 }).then(() => 'new'),
        select.waitFor({ timeout: 20000 }).then(() => 'existing'),
    ])
    if (first === 'new') {
        await nameInput.fill(user)
        await gw.locator('select').first().selectOption({ index: 1 }) // wallet-kernel
        await gw.getByText('Create party', { exact: true }).click()
        return // a new party is connected right away, there is nothing to select
    }
    await gw.getByText('Select', { exact: true }).click({ timeout: 30000 })
}

/** Open the dApp as `user` (already onboarded): connect through the gateway popup and select the auth party. */
export async function login(browser, user, { register = true } = {}) {
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
    })
    const page = await ctx.newPage()
    page.on('dialog', (d) => {
        console.log(`[${user}] DIALOG:`, d.message())
        d.dismiss()
    })
    await page.goto(APP_URL)
    await connectFlow(ctx, page, user, () =>
        page.getByText('Connect wallet').click()
    )
    await page
        .locator('#signup:not([hidden]), #lobby:not([hidden])')
        .first()
        .waitFor()
    const me = {
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
    if (register && (await page.locator('#signup:not([hidden])').count())) {
        await me.approve(() => page.getByText('Create chess account').click())
        await page.locator('#lobby:not([hidden])').waitFor({ timeout: 30000 })
    }
    return me
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

/** Move a piece on the chessground board with the mouse (squares are not elements, so compute coordinates). */
export async function dragSquares(page, from, to) {
    const board = page.locator('li.game cg-board').first()
    await board.locator('piece').first().waitFor({ timeout: 20000 })
    const box = await board.boundingBox()
    const black =
        (await page.locator('li.game .cg-wrap.orientation-black').count()) > 0
    const at = (sq) => {
        const f = 'abcdefgh'.indexOf(sq[0])
        const r = Number(sq[1]) - 1
        return {
            x: box.x + ((black ? 7 - f : f) + 0.5) * (box.width / 8),
            y: box.y + ((black ? r : 7 - r) + 0.5) * (box.height / 8),
        }
    }
    const a = at(from)
    const b = at(to)
    // chessground also moves by selecting a piece and then clicking the destination
    await page.mouse.click(a.x, a.y)
    await page.mouse.click(b.x, b.y)
}

/** Drag a piece as `u` (alice is Black, bob is White in the e2e games). Waits until the page shows it is the
 * player's turn: the other side's move arrives by polling. */
export async function dragMove(u, from, to) {
    const colour = u.user === 'bob' ? 'White' : 'Black'
    await u.page.waitForFunction(
        (t) => document.querySelector('li.game')?.textContent.includes(t),
        `${colour} to move`,
        { timeout: 20000 }
    )
    await u.approve(() => dragSquares(u.page, from, to))
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

/** The piece on a square according to the game's FEN ('..' if empty), e.g. 'wP'. */
export async function square(u, sq) {
    const fen = await u.page.locator('li.game').first().getAttribute('data-fen')
    const rows = fen.split(' ')[0].split('/')
    const row = rows[8 - Number(sq[1])].replace(/\d/g, (n) =>
        '.'.repeat(Number(n))
    )
    const c = row['abcdefgh'.indexOf(sq[0])]
    if (c === '.') return '..'
    return (c === c.toUpperCase() ? 'w' : 'b') + c.toUpperCase()
}
