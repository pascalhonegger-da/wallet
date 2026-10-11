// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { api } from './ledger'

type Json = Record<string, unknown>
type Link = { previous: string; san?: string }

const PAGE = 100 // the endpoint returns 413 for larger result sets, so page with `limit`
const linkTo = new Map<string, Link>() // contract created by a move -> the contract it replaced, and the move
let readUpTo = 0
let reader = ''

let inFlight: Promise<void> | undefined

/** Read ledger events we have not seen yet. `party` must be able to see the games (a player). */
export function refreshHistory(party: string): Promise<void> {
    // one read at a time: callers fire this on every change and would otherwise read the same events twice
    inFlight ??= read(party).finally(() => {
        inFlight = undefined
    })
    return inFlight
}

export type Tx = { offset: number; effectiveAt?: string; events: Json[] }

/** All transactions (ledger-effects shape) visible to `party` in (from, to], read in pages. */
export async function transactions(
    party: string,
    from: number,
    to: number
): Promise<Tx[]> {
    const out: Tx[] = []
    let readUpTo = from
    while (readUpTo < to) {
        const updates: Json[] = await api(
            'post',
            '/v2/updates',
            {
                beginExclusive: readUpTo,
                endInclusive: to,
                updateFormat: {
                    includeTransactions: {
                        eventFormat: {
                            filtersByParty: {
                                [party]: {
                                    cumulative: [
                                        {
                                            identifierFilter: {
                                                WildcardFilter: {
                                                    value: {
                                                        includeCreatedEventBlob: false,
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                            verbose: false,
                        },
                        transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
                    },
                },
            },
            { limit: PAGE }
        )
        for (const item of updates) {
            const tx = (
                (item.update as Json | undefined)?.Transaction as
                    { value?: Json } | undefined
            )?.value as Tx | undefined
            if (!tx) continue
            out.push(tx)
            readUpTo = Math.max(readUpTo, tx.offset)
        }
        if (updates.length < PAGE) readUpTo = to
    }
    return out
}

// Every choice that replaces the game contract. Only Move carries a move, but the others must be linked as well,
// or the chain back to the first move would break after a draw offer.
const CHAIN_CHOICES = [
    'Move',
    'Resign',
    'OfferDraw',
    'RetractDraw',
    'DeclineDraw',
    'AcceptDraw',
]

async function read(party: string): Promise<void> {
    if (reader !== party) {
        linkTo.clear()
        readUpTo = 0
        reader = party
    }
    const { offset: end } = await api('get', '/v2/state/ledger-end')
    for (const tx of await transactions(party, readUpTo, end))
        for (const event of tx.events) {
            const ex = event.ExercisedEvent as
                | {
                      choice: string
                      contractId: string
                      choiceArgument: { san?: string }
                      exerciseResult: string | { value: string }
                  }
                | undefined
            if (!ex || !CHAIN_CHOICES.includes(ex.choice)) continue
            const result =
                typeof ex.exerciseResult === 'string'
                    ? ex.exerciseResult
                    : ex.exerciseResult.value
            linkTo.set(result, {
                previous: ex.contractId,
                san: ex.choiceArgument.san,
            })
        }
    readUpTo = end
}

/** The moves that led to this Game or GameResult contract, oldest first. */
export function movesOf(contractId: string): string[] {
    const moves: string[] = []
    for (
        let link = linkTo.get(contractId);
        link;
        link = linkTo.get(link.previous)
    )
        if (link.san) moves.unshift(link.san)
    return moves
}

/** The first contract of the chain this Game or GameResult belongs to: the same for every version of a game. */
export function rootOf(contractId: string): string {
    let id = contractId
    for (let link = linkTo.get(id); link; link = linkTo.get(id))
        id = link.previous
    return id
}

/** "1. e4 e5 2. Nf3" */
export function movesText(moves: string[]): string {
    return moves
        .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
        .join(' ')
}
