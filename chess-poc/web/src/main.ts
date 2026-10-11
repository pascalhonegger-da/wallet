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
const RESULT = '#chess-poc:Chess:GameResult'

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
    drawOfferedBy?: string | null
}
type GameResult = {
    white: string
    black: string
    outcome: string
    reason: string
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
        <section><h4>Results</h4><ul id="results"></ul></section>
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

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function asciiBoard(board: Record<string, string>) {
    return [8, 7, 6, 5, 4, 3, 2, 1]
        .map(
            (r) =>
                `${r} ` +
                FILES.map((f) => (board[f + r] ?? '..').padEnd(2)).join(' ')
        )
        .concat(['  ' + FILES.map((f) => f + ' ').join(' ')])
        .join('\n')
}

function gameHtml(cid: string, g: Game) {
    const me = party === g.white ? 'White' : party === g.black ? 'Black' : null
    const myTurn = me === g.turn
    const opponent = party === g.white ? g.black : g.white
    let draw: string
    if (g.drawOfferedBy == null)
        draw = `<button data-act="OfferDraw" data-cid="${cid}">Offer draw</button>`
    else if (g.drawOfferedBy === party)
        draw = `<button data-act="RetractDraw" data-cid="${cid}">Retract draw offer</button>`
    else
        draw = `${nameOf(opponent)} offers a draw
            <button data-act="AcceptDraw" data-cid="${cid}">Accept draw</button>
            <button data-act="DeclineDraw" data-cid="${cid}">Decline draw</button>`
    return `<li class="game">
        ${nameOf(g.white)} (white) vs ${nameOf(g.black)} (black), ${g.turn} to move, move ${g.moveCount}
        <pre>${asciiBoard(g.board)}</pre>
        ${myTurn ? `<input class="from" size="2" placeholder="e2"> to <input class="to" size="2" placeholder="e4"> <button data-act="Move" data-cid="${cid}">Move</button>` : ''}
        <button data-act="Resign" data-cid="${cid}">Resign</button> ${draw}
    </li>`
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
        const [counters, challenges, games, results] = await Promise.all([
            queryActive<{ value: string }>(party, COUNTER),
            queryActive<Challenge>(party, CHALLENGE),
            queryActive<Game>(party, GAME),
            queryActive<GameResult>(party, RESULT),
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
                .map(({ contractId, payload }) => gameHtml(contractId, payload))
                .join('')
        )
        setList(
            'results',
            results
                .map(
                    ({ payload: r }) =>
                        `<li>${nameOf(r.white)} (white) vs ${nameOf(r.black)} (black): ${r.outcome} by ${r.reason} after ${r.moveCount} moves</li>`
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
    const act = b.dataset.act!
    const cid = b.dataset.cid!
    if (act === 'Increment')
        return void run(() => exercise(party, COUNTER, cid, act))
    if (['Accept', 'Decline', 'Cancel'].includes(act))
        return void run(() => exercise(party, CHALLENGE, cid, act))
    // Game choices all take `actor`; Move also reads the squares typed next to the button.
    const arg: Record<string, string> = { actor: party }
    if (act === 'Move') {
        const li = b.closest('li')!
        arg.fromSq = li
            .querySelector<HTMLInputElement>('.from')!
            .value.trim()
            .toLowerCase()
        arg.toSq = li
            .querySelector<HTMLInputElement>('.to')!
            .value.trim()
            .toLowerCase()
    }
    run(() => exercise(party, GAME, cid, act, arg))
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
