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
import './style.css'
import { installDebug } from './debug'
import { mountBoard, type Board } from './board'
import { movesOf, refreshHistory, rootOf } from './history'
import {
    checkMove,
    destsOf,
    fullmoveOf,
    positionNote,
    replay,
    turnOf,
} from './rules'

const CHALLENGE = '#chess-poc:Chess:Challenge'
const GAME = '#chess-poc:Chess:Game'
const RESULT = '#chess-poc:Chess:GameResult'
const PLAYER = '#chess-poc:Chess:Player'

// gatewayUrl: the gateway's dApp API; by default the gateway is served under /wallet-gateway on the same origin
type Config = { lobby: string; gatewayUrl?: string }
type Player = { player: string; lobby: string }
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

/** Party ids look like `alice::1220…`: the part before `::` is the name the player signed up with. */
const nameOf = (p: string) => p.split('::')[0]

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
    app.innerHTML = `
        <header><span class="logo">♞ Canton Chess</span><span>You are <b>${nameOf(party)}</b> <small id="status"></small> <small id="waiting"></small></span></header>
        <div id="message" role="alert"></div>
        <section id="signup" hidden>
            <h4>Welcome, ${nameOf(party)}</h4>
            <p>Create a chess account so other players can see you and challenge you. This publishes a small contract
            that only says that you play here.</p>
            <button id="create-account">Create chess account</button>
        </section>
        <div id="lobby" hidden>
        <section><h4>Games</h4><ul id="games"></ul></section>
        <section id="new-challenge">
            <h4>New challenge</h4>
            <select id="opponent"></select>
            <select id="color"><option>White</option><option>Black</option></select>
            <button id="challenge">Challenge</button>
            <span id="no-players" hidden>No other players have signed up yet.</span>
        </section>
        <section><h4>Players</h4><div id="players"></div></section>
        <section><h4>Challenges</h4><ul id="challenges"></ul></section>
        <section><h4>Results</h4><ul id="results"></ul></section>
        </div>
        <footer>For the ledger state in raw form open the browser console and run <code>chessDebug.contracts()</code> or <code>chessDebug.events()</code> (<code>chessDebug.help()</code> lists more).</footer>`

    app.querySelector('#create-account')!.addEventListener('click', () =>
        run(() =>
            create(party, PLAYER, {
                player: party,
                lobby: config.lobby,
            })
        )
    )
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
}

const navHtml = `<div class="nav">
    <button data-nav="first" title="start">⏮</button><button data-nav="prev" title="previous move">◀</button>
    <button data-nav="next" title="next move">▶</button><button data-nav="last" title="latest position">⏭</button></div>`

function gameHtml(cid: string, g: Game) {
    const turn = turnOf(g.fen)
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
    return `<li class="game" data-cid="${cid}" data-fen="${g.fen}">
        <div class="board"></div>
        <div class="side">
            <div class="players">${nameOf(g.white)} (white) vs ${nameOf(g.black)} (black)</div>
            <div class="turn">${turn} to move, move ${fullmoveOf(g.fen)}</div>
            <div class="note">${positionNote(g.fen)}</div>
            <div class="movelist" data-cid="${cid}"></div>
            ${navHtml}
            <div class="actions"><button data-act="Resign" data-cid="${cid}">Resign</button> ${draw}</div>
        </div>
    </li>`
}

const currentGames = new Map<string, Game>()

/** Check the move against the chess rules, then submit it. Illegal moves never reach the ledger. */
async function tryMove(cid: string, g: Game, fromSq: string, toSq: string) {
    const check = checkMove(g.fen, fromSq, toSq)
    if (!check.ok) return showMessage(check.reason)
    showMessage('')
    await run(() =>
        exercise(party, GAME, cid, 'Move', { actor: party, san: check.san })
    )
}

/** (Re)mount a chessground board in every game item; called whenever the games list HTML was replaced. */
function mountBoards(games: { contractId: string; payload: Game }[]) {
    for (const { contractId: cid, payload: g } of games) {
        const li = document.querySelector<HTMLElement>(
            `li.game[data-cid="${cid}"]`
        )
        if (!li) continue
        const mine =
            party === g.white ? 'White' : party === g.black ? 'Black' : null
        const myTurn = mine !== null && mine === turnOf(g.fen)
        boards.set(
            cid,
            mountBoard(li.querySelector<HTMLElement>('.board')!, {
                fen: g.fen,
                orientation: party === g.black ? 'black' : 'white',
                color: mine === 'Black' ? 'black' : 'white',
                dests: myTurn && !busy ? destsOf(g.fen) : undefined,
                onMove: (fromSq, toSq) => tryMove(cid, g, fromSq, toSq),
            })
        )
    }
}

/** Mount a view-only board for every opened past game. */
function mountResultBoards(
    results: { contractId: string; payload: GameResult }[]
) {
    for (const { contractId: cid, payload: r } of results) {
        const el = document.querySelector<HTMLElement>(
            `li.result[data-cid="${cid}"] .board`
        )
        if (!el) continue
        boards.set(
            cid,
            mountBoard(el, {
                fen: r.fen,
                orientation: party === r.black ? 'black' : 'white',
                color: 'white',
                onMove: async () => {},
            })
        )
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
    document
        .querySelectorAll<HTMLElement>('.movelist')
        .forEach((el) => renderMoves(el))
}

const boards = new Map<string, Board>() // contract id -> its board
const viewPly = new Map<string, number>() // game (id of its first contract) -> the ply being looked at; absent = latest
const openResults = new Set<string>() // finished games whose board is open

/** Draw one move list (each move is clickable) and show the position it points at on the game's board. */
function renderMoves(
    el: HTMLElement,
    goTo?: 'first' | 'prev' | 'next' | 'last' | number
) {
    const cid = el.dataset.cid!
    const moves = movesOf(cid)
    const root = rootOf(cid)
    const latest = moves.length
    let ply = viewPly.get(root) ?? latest
    if (goTo === 'first') ply = 0
    else if (goTo === 'prev') ply = Math.max(0, ply - 1)
    else if (goTo === 'next') ply = Math.min(latest, ply + 1)
    else if (goTo === 'last') ply = latest
    else if (typeof goTo === 'number') ply = goTo
    if (ply >= latest) viewPly.delete(root)
    else viewPly.set(root, ply)
    el.innerHTML = moves
        .map(
            (san, i) =>
                `${i % 2 === 0 ? `${i / 2 + 1}. ` : ''}<span class="mv${i + 1 === ply ? ' sel' : ''}" data-ply="${i + 1}">${san}</span>`
        )
        .join(' ')
    const board = boards.get(cid)
    if (!board) return
    if (ply >= latest) return board.live()
    const r = replay(moves)
    board.show(r.fens[ply], r.last[ply])
}

/** Sign-up state: without a `Player` contract of your own you only see the sign-up card; the other players you can
 * challenge are all registered players, which everybody reads through the lobby party. */
function showPlayers(visible: Player[]) {
    const registered = visible.some((p) => p.player === party)
    document.getElementById('signup')!.hidden = registered
    document.getElementById('lobby')!.hidden = !registered
    const others = [
        ...new Set(visible.map((p) => p.player).filter((p) => p !== party)),
    ].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    const select = document.getElementById('opponent') as HTMLSelectElement
    const wanted = others.join(',')
    if (select.dataset.players !== wanted) {
        const chosen = select.value
        select.dataset.players = wanted
        select.innerHTML = others
            .map((p) => `<option value="${p}">${nameOf(p)}</option>`)
            .join('')
        if (others.includes(chosen)) select.value = chosen // keep the selection while the list grows
    }
    document.getElementById('no-players')!.hidden = others.length > 0
    ;(document.getElementById('challenge') as HTMLButtonElement).hidden =
        others.length === 0
    select.hidden = others.length === 0
    document.getElementById('players')!.textContent = [
        `you (${nameOf(party)})`,
        ...others.map(nameOf),
    ].join(', ')
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
        const [own, everyone, challenges, games, results] = await Promise.all([
            queryActive<Player>(party, PLAYER),
            // readable once the player's user was granted CanReadAs for the lobby (a second or so after first login)
            queryActive<Player>(config.lobby, PLAYER).catch(() => []),
            queryActive<Challenge>(party, CHALLENGE),
            queryActive<Game>(party, GAME),
            queryActive<GameResult>(party, RESULT),
        ])
        showPlayers([...own, ...everyone].map((c) => c.payload))
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
                        `<li class="result" data-cid="${contractId}">
                        <div>${nameOf(r.white)} (white) vs ${nameOf(r.black)} (black): ${r.outcome} by ${r.reason} after ${fullmoveOf(r.fen)} moves
                        <button data-act="ToggleResult" data-cid="${contractId}">${openResults.has(contractId) ? 'Close' : 'Open'}</button></div>
                        <div class="replay"${openResults.has(contractId) ? '' : ' hidden'}>
                            <div class="board"></div>
                            <div class="side"><div class="movelist" data-cid="${contractId}"></div>${navHtml}</div>
                        </div></li>`
                )
                .join('')
        )
        if (resultsChanged) mountResultBoards(results)
        if (gamesChanged || resultsChanged || historyStale) void showHistory()
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
    const target = e.target as HTMLElement
    const mv = target.closest<HTMLElement>('.mv')
    if (mv)
        return renderMoves(
            mv.closest<HTMLElement>('.movelist')!,
            Number(mv.dataset.ply)
        )
    const nav = target.closest<HTMLElement>('button[data-nav]')
    if (nav) {
        const list = nav.closest('li')!.querySelector<HTMLElement>('.movelist')!
        return renderMoves(list, nav.dataset.nav as 'first')
    }
    const b = target.closest<HTMLButtonElement>('button[data-act]')
    if (!b) return
    const act = b.dataset.act!
    const cid = b.dataset.cid!
    if (act === 'ToggleResult') {
        if (!openResults.delete(cid)) openResults.add(cid)
        const li = b.closest('li')!
        li.querySelector<HTMLElement>('.replay')!.hidden = !openResults.has(cid)
        b.textContent = openResults.has(cid) ? 'Close' : 'Open'
        delete lastHtml['results'] // re-render (and mount the board) with the next refresh
        return void refresh()
    }
    if (['Accept', 'Decline', 'Cancel'].includes(act))
        return void run(() => exercise(party, CHALLENGE, cid, act))
    // Game choices all take `actor`.
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
    await init(
        config.gatewayUrl ??
            new URL('/wallet-gateway/api/v0/dapp', location.origin).href
    )
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
installDebug(() => party)
main()
