// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    create,
    exercise,
    init,
    primaryParty,
    queryActive,
    sdk,
} from './ledger'

const COUNTER = '#chess-poc:Counter:Counter'
const CHALLENGE = '#chess-poc:Chess:Challenge'
const GAME = '#chess-poc:Chess:Game'

type Config = { players: Record<string, string>; lobby: string }
type Challenge = {
    creator: string
    opponent: string
    lobby: string
    creatorColor: 'White' | 'Black'
}
type Game = {
    white: string
    black: string
    board: Record<string, string>
    turn: 'White' | 'Black'
    moveCount: string
}

const app = document.getElementById('app')!
let party = ''
let config: Config

const nameOf = (p: string) =>
    Object.entries(config.players).find(([, id]) => id === p)?.[0] ??
    p.split('::')[0]

const POLL_MS = 2000
let timer: ReturnType<typeof setInterval> | undefined
let polling = false
const lastHtml: Record<string, string> = {}

/** Static part of the page: rendered once so polling never resets form inputs. */
function renderShell() {
    const opponents = Object.entries(config.players).filter(
        ([n, id]) => id !== party && n !== 'lobby'
    )
    app.innerHTML = `
        <h3>You are <b>${nameOf(party)}</b> <small id="status"></small></h3>
        <section id="new-challenge">
            <h4>New challenge</h4>
            <select id="opponent">${opponents.map(([n, id]) => `<option value="${id}">${n}</option>`).join('')}</select>
            <select id="color"><option>White</option><option>Black</option></select>
            <button id="challenge">Challenge</button>
        </section>
        <section><h4>Challenges</h4><ul id="challenges"></ul></section>
        <section><h4>Games</h4><ul id="games"></ul></section>
        <section><h4>Counters (milestone 1)</h4><button id="new">New counter</button><ul id="counters"></ul></section>`

    app.querySelector('#challenge')!.addEventListener('click', () =>
        run(() =>
            create(party, CHALLENGE, {
                creator: party,
                opponent: (
                    document.getElementById('opponent') as HTMLSelectElement
                ).value,
                lobby: config.lobby,
                creatorColor: (
                    document.getElementById('color') as HTMLSelectElement
                ).value,
            })
        )
    )
    app.querySelector('#new')!.addEventListener('click', () =>
        run(() => create(party, COUNTER, { owner: party, value: '0' }))
    )
}

/** Replace a list's contents only if they changed. */
function setList(id: string, html: string) {
    if (lastHtml[id] === html) return
    lastHtml[id] = html
    document.getElementById(id)!.innerHTML = html
}

async function refresh() {
    if (polling) return
    polling = true
    try {
        const [counters, challenges, games] = await Promise.all([
            queryActive<{ value: string }>(party, COUNTER),
            queryActive<Challenge>(party, CHALLENGE),
            queryActive<Game>(party, GAME),
        ])
        setList(
            'challenges',
            challenges
                .map(({ contractId: cid, payload: c }) => {
                    const buttons =
                        c.opponent === party
                            ? `<button data-act="Accept" data-cid="${cid}">Accept</button>
                               <button data-act="Decline" data-cid="${cid}">Decline</button>`
                            : c.creator === party
                              ? `<button data-act="Cancel" data-cid="${cid}">Cancel</button>`
                              : ''
                    return `<li>${nameOf(c.creator)} challenges ${nameOf(c.opponent)} (${nameOf(c.creator)} plays ${c.creatorColor}) ${buttons}</li>`
                })
                .join('')
        )
        setList(
            'games',
            games
                .map(
                    ({ payload: g }) =>
                        `<li>${nameOf(g.white)} (white) vs ${nameOf(g.black)} (black), ${g.turn} to move, move ${g.moveCount}</li>`
                )
                .join('')
        )
        setList(
            'counters',
            counters
                .map(
                    (c) =>
                        `<li class="counter">${c.payload.value} <button data-cid="${c.contractId}" data-act="Increment">+1</button></li>`
                )
                .join('')
        )
        document.getElementById('status')!.textContent = ''
    } catch (e) {
        console.error(e)
        document.getElementById('status')!.textContent =
            '(ledger unreachable, retrying)'
    } finally {
        polling = false
    }
}

async function run(f: () => Promise<unknown>) {
    try {
        await f()
    } catch (e) {
        console.error(e)
        alert(String((e as Error).message ?? e))
    }
    await refresh()
}

// List buttons are re-created on every update, so listen once on the app root.
app.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
        'button[data-act]'
    )
    if (!b) return
    const tpl = b.dataset.act === 'Increment' ? COUNTER : CHALLENGE
    run(() => exercise(party, tpl, b.dataset.cid!, b.dataset.act!))
})

async function main() {
    config = await (await fetch('/config.json')).json()
    await init()
    app.innerHTML = '<button id="connect">Connect wallet</button>'
    const start = async () => {
        party = await primaryParty()
        // The user can switch their primary party in the wallet: re-read it instead of caching.
        await sdk.onAccountsChanged(async () => {
            party = await primaryParty()
            for (const k of Object.keys(lastHtml)) delete lastHtml[k]
            renderShell()
            await refresh()
        })
        renderShell()
        await refresh()
        clearInterval(timer)
        timer = setInterval(refresh, POLL_MS)
    }
    if (
        await sdk
            .isConnected()
            .then((r) => (r as { isConnected: boolean }).isConnected)
            .catch(() => false)
    )
        return start()
    app.querySelector('#connect')!.addEventListener('click', async () => {
        await sdk.connect()
        await start()
    })
}
main()
