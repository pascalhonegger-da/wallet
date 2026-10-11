// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    create,
    exercise,
    init,
    primaryParty,
    queryActive,
    sdk,
    setApprovalTimeout,
} from './ledger'
import { mountBoard } from './board'
import { movesOf, movesText, refreshHistory } from './history'
import {
    boardOf,
    checkMove,
    fullmoveOf,
    placementOf,
    positionNote,
    turnOf,
} from './rules'

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
    fen: string
    drawOfferedBy?: string | null
}
type GameResult = {
    white: string
    black: string
    outcome: string
    reason: string
    fen: string
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
let paused = false // test hook: lets the e2e check act on a deliberately stale view
let busy = false // one submission at a time: prevents double clicks
let failures = 0 // consecutive failed polls: two or more means the session has probably expired
let historyStale = false // the last history read failed: retry on the next poll
const lastHtml: Record<string, string> = {}

/** Static part of the page: rendered once so polling never resets form inputs. */
function renderShell() {
    const opponents = Object.entries(config.players).filter(
        ([n, id]) => id !== party && n !== 'lobby'
    )
    app.innerHTML = `
        <h3>You are <b>${nameOf(party)}</b> <small id="status"></small> <small id="waiting"></small></h3>
        <div id="message" role="alert" style="color: #b00020"></div>
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
    const turn = turnOf(g.fen)
    const myTurn = me === turn
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
    return `<li class="game" data-cid="${cid}">
        ${nameOf(g.white)} (white) vs ${nameOf(g.black)} (black), ${turn} to move, move ${fullmoveOf(g.fen)}
        <div class="note">${positionNote(g.fen)}</div>
        <div class="movelist" data-cid="${cid}"></div>
        <div class="board" style="width: 320px"></div>
        <details><summary>text board / type a move</summary>
            <pre>${asciiBoard(boardOf(g.fen))}</pre>
            ${myTurn ? `<input class="from" size="2" placeholder="e2"> to <input class="to" size="2" placeholder="e4"> <button data-act="Move" data-cid="${cid}">Move</button>` : ''}
        </details>
        <button data-act="Resign" data-cid="${cid}">Resign</button> ${draw}
    </li>`
}

const currentGames = new Map<string, Game>()

/** Check the move against the chess rules, then submit it. Illegal moves never reach the ledger. */
function tryMove(cid: string, g: Game, fromSq: string, toSq: string) {
    const check = checkMove(g.fen, fromSq, toSq)
    if (!check.ok) return showMessage(check.reason)
    showMessage('')
    void run(() =>
        exercise(party, GAME, cid, 'Move', { actor: party, san: check.san })
    )
}

/** (Re)mount a chessboard.js board in every game item; called whenever the games list HTML was replaced. */
function mountBoards(games: { contractId: string; payload: Game }[]) {
    for (const { contractId: cid, payload: g } of games) {
        const li = document.querySelector<HTMLElement>(
            `li.game[data-cid="${cid}"]`
        )
        if (!li) continue
        const mine = party === g.white ? 'w' : party === g.black ? 'b' : ''
        const myTurn = (turnOf(g.fen) === 'White' ? 'w' : 'b') === mine
        void mountBoard(li.querySelector<HTMLElement>('.board')!, {
            position: placementOf(g.fen),
            orientation: party === g.black ? 'black' : 'white',
            canDrag: (piece) => !busy && myTurn && piece[0] === mine,
            onMove: (fromSq, toSq) => tryMove(cid, g, fromSq, toSq),
        })
    }
}

/** Fill the move lists from the ledger's event history (see history.ts). */
async function showHistory() {
    try {
        await refreshHistory(party)
        historyStale = false
    } catch (e) {
        console.error('could not read the move history', e)
        historyStale = true
        return
    }
    document.querySelectorAll<HTMLElement>('.movelist').forEach((el) => {
        el.textContent = movesText(movesOf(el.dataset.cid!))
    })
}

/** Replace a list's contents only if they changed. */
function setList(id: string, html: string): boolean {
    if (lastHtml[id] === html) return false
    lastHtml[id] = html
    document.getElementById(id)!.innerHTML = html
    return true
}

async function refresh() {
    if (polling || paused) return
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
        currentGames.clear()
        for (const { contractId, payload } of games)
            currentGames.set(contractId, payload)
        const gamesChanged = setList(
            'games',
            games
                .map(({ contractId, payload }) => gameHtml(contractId, payload))
                .join('')
        )
        if (gamesChanged) mountBoards(games)
        const resultsChanged = setList(
            'results',
            results
                .map(
                    ({ contractId, payload: r }) =>
                        `<li>${nameOf(r.white)} (white) vs ${nameOf(r.black)} (black): ${r.outcome} by ${r.reason} after ${fullmoveOf(r.fen)} moves
                        <div class="movelist" data-cid="${contractId}"></div></li>`
                )
                .join('')
        )
        if (gamesChanged || resultsChanged || historyStale) void showHistory()
        setList(
            'counters',
            counters
                .map(
                    (c) =>
                        `<li class="counter">${c.payload.value} <button data-cid="${c.contractId}" data-act="Increment">+1</button></li>`
                )
                .join('')
        )
        failures = 0
        document.getElementById('status')!.textContent = ''
    } catch (e) {
        console.error(e)
        failures++
        // The gateway's self-issued access tokens last 10 minutes and are not refreshed.
        document.getElementById('status')!.innerHTML =
            failures >= 2
                ? '(cannot reach the ledger: the session may have expired) <button id="reconnect">Reconnect</button>'
                : '(ledger unreachable, retrying)'
    } finally {
        polling = false
    }
}

const setWaiting = (text: string) => {
    const el = document.getElementById('waiting')
    if (el) el.textContent = text
}

let messageTimer: ReturnType<typeof setTimeout> | undefined
function showMessage(text: string) {
    const el = document.getElementById('message')
    if (!el) return
    el.textContent = text
    clearTimeout(messageTimer)
    if (text) messageTimer = setTimeout(() => (el.textContent = ''), 10000)
}

/** Turn ledger/gateway errors into something a player can act on. */
function friendlyError(e: unknown): string {
    const msg = String((e as Error)?.message ?? e)
    if (
        /CONTRACT_NOT_FOUND|CONTRACT_NOT_ACTIVE|could not be found|not active|inactive|archived|consumed|UNKNOWN_CONTRACT/i.test(
            msg
        )
    )
        return 'Too late: the other side changed this first. The view has been refreshed.'
    if (/failed to execute|rejected/i.test(msg))
        return 'The wallet rejected the transaction, or it failed.'
    // Canton wraps what a Daml choice aborted with: "... (error category 9): illegal move: e5"
    const daml =
        /\(error category \d+\):\s*(.+)$/s.exec(msg) ??
        /(?:Aborted|Assertion failed|ABORT)[^:]*:\s*(.+)$/is.exec(msg)
    if (daml) return `Not allowed: ${daml[1].split('\n')[0].trim()}`
    return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}

async function run(f: () => Promise<unknown>) {
    if (busy) return
    if (failures >= 2)
        return showMessage(
            'Your session may have expired: use Reconnect at the top of the page.'
        )
    busy = true
    document.body.classList.add('busy')
    setWaiting('waiting for the wallet…')
    try {
        await f()
        showMessage('')
    } catch (e) {
        console.error(e)
        showMessage(friendlyError(e))
    } finally {
        busy = false
        document.body.classList.remove('busy')
        setWaiting('')
    }
    await refresh()
}

// List buttons are re-created on every update, so listen once on the app root.
app.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'reconnect') return void reconnect()
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
    // Game choices all take `actor`; Move reads the squares typed next to the button and is rule-checked.
    if (act === 'Move') {
        const li = b.closest('li')!
        const g = currentGames.get(cid)
        if (!g) return
        const sq = (cls: string) =>
            li.querySelector<HTMLInputElement>(cls)!.value.trim().toLowerCase()
        return tryMove(cid, g, sq('.from'), sq('.to'))
    }
    const arg: Record<string, string> = { actor: party }
    run(() => exercise(party, GAME, cid, act, arg))
})

let accountsListening = false

async function start() {
    party = await primaryParty()
    if (!accountsListening) {
        accountsListening = true
        // The user can switch their primary party in the wallet: re-read it instead of caching.
        await sdk.onAccountsChanged(async () => {
            party = await primaryParty()
            for (const k of Object.keys(lastHtml)) delete lastHtml[k]
            renderShell()
            await refresh()
        })
    }
    for (const k of Object.keys(lastHtml)) delete lastHtml[k]
    renderShell()
    await refresh()
    clearInterval(timer)
    timer = setInterval(refresh, POLL_MS)
}

/** Log in again through the wallet, e.g. after the session expired. */
async function reconnect() {
    try {
        await sdk.disconnect()
    } catch (e) {
        console.error(e)
    }
    await sdk.connect()
    failures = 0
    await start()
}

async function main() {
    config = await (await fetch('/config.json')).json()
    await init()
    app.innerHTML = '<button id="connect">Connect wallet</button>'
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
// Test hooks for the e2e checks (they have no effect on normal use).
Object.assign(window, {
    __chess: {
        pause: () => (paused = true),
        resume: () => (paused = false),
        setApprovalTimeout,
        /** Submit a move for the first game exactly as given, skipping the UI's own rule check:
         * what a modified or misbehaving client could do. */
        submitSan: (san: string) => {
            const cid = [...currentGames.keys()][0]
            return run(() =>
                exercise(party, GAME, cid, 'Move', { actor: party, san })
            )
        },
    },
})
main()
