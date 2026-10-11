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

async function render() {
    const [counters, challenges, games] = await Promise.all([
        queryActive<{ value: string }>(party, COUNTER),
        queryActive<Challenge>(party, CHALLENGE),
        queryActive<Game>(party, GAME),
    ])
    const opponents = Object.entries(config.players).filter(
        ([n, id]) => id !== party && n !== 'lobby'
    )
    app.innerHTML = `
        <h3>You are <b>${nameOf(party)}</b></h3>
        <section id="new-challenge">
            <h4>New challenge</h4>
            <select id="opponent">${opponents.map(([n, id]) => `<option value="${id}">${n}</option>`).join('')}</select>
            <select id="color"><option>White</option><option>Black</option></select>
            <button id="challenge">Challenge</button>
        </section>
        <section id="challenges">
            <h4>Challenges (${challenges.length})</h4>
            <ul>${challenges
                .map(({ contractId: cid, payload: c }) => {
                    const mine = c.creator === party
                    const buttons =
                        c.opponent === party
                            ? `<button data-act="Accept" data-cid="${cid}">Accept</button>
                               <button data-act="Decline" data-cid="${cid}">Decline</button>`
                            : mine
                              ? `<button data-act="Cancel" data-cid="${cid}">Cancel</button>`
                              : ''
                    return `<li>${nameOf(c.creator)} challenges ${nameOf(c.opponent)} (${nameOf(c.creator)} plays ${c.creatorColor}) ${buttons}</li>`
                })
                .join('')}</ul>
        </section>
        <section id="games">
            <h4>Games (${games.length})</h4>
            <ul>${games
                .map(
                    ({ payload: g }) =>
                        `<li>${nameOf(g.white)} (white) vs ${nameOf(g.black)} (black), ${g.turn} to move, move ${g.moveCount}</li>`
                )
                .join('')}</ul>
        </section>
        <section id="counters">
            <h4>Counters (milestone 1)</h4>
            <button id="new">New counter</button>
            <ul>${counters
                .map(
                    (c) =>
                        `<li class="counter">${c.payload.value} <button data-cid="${c.contractId}" data-act="Increment">+1</button></li>`
                )
                .join('')}</ul>
        </section>`

    on('#challenge', () =>
        create(party, CHALLENGE, {
            creator: party,
            opponent: (document.getElementById('opponent') as HTMLSelectElement)
                .value,
            lobby: config.lobby,
            creatorColor: (
                document.getElementById('color') as HTMLSelectElement
            ).value,
        })
    )
    on('#new', () => create(party, COUNTER, { owner: party, value: '0' }))
    app.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
        b.addEventListener('click', () => {
            const tpl = b.dataset.act === 'Increment' ? COUNTER : CHALLENGE
            return run(() =>
                exercise(party, tpl, b.dataset.cid!, b.dataset.act!)
            )
        })
    )
}

function on(sel: string, f: () => Promise<unknown>) {
    app.querySelector(sel)!.addEventListener('click', () => run(f))
}

async function run(f: () => Promise<unknown>) {
    try {
        await f()
    } catch (e) {
        console.error(e)
        alert(String((e as Error).message ?? e))
    }
    await render()
}

async function main() {
    config = await (await fetch('/config.json')).json()
    await init()
    app.innerHTML = '<button id="connect">Connect wallet</button>'
    const start = async () => {
        party = await primaryParty()
        // The user can switch their primary party in the wallet: re-read it instead of caching.
        await sdk.onAccountsChanged(async () => {
            party = await primaryParty()
            await render()
        })
        await render()
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
