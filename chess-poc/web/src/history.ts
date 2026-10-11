// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { api } from './ledger'

type Json = Record<string, unknown>
type Link = { previous: string; san: string }

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

async function read(party: string): Promise<void> {
    if (reader !== party) {
        linkTo.clear()
        readUpTo = 0
        reader = party
    }
    const { offset: end } = await api('get', '/v2/state/ledger-end')
    while (readUpTo < end) {
        const updates: Json[] = await api(
            'post',
            '/v2/updates',
            {
                beginExclusive: readUpTo,
                endInclusive: end,
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
            )?.value as { offset: number; events: Json[] } | undefined
            if (!tx) continue
            for (const event of tx.events) {
                const ex = event.ExercisedEvent as
                    | {
                          choice: string
                          contractId: string
                          choiceArgument: { san?: string }
                          exerciseResult: { tag: string; value: string }
                      }
                    | undefined
                if (ex?.choice !== 'Move' || !ex.choiceArgument.san) continue
                linkTo.set(ex.exerciseResult.value, {
                    previous: ex.contractId,
                    san: ex.choiceArgument.san,
                })
            }
            readUpTo = Math.max(readUpTo, tx.offset)
        }
        if (updates.length < PAGE) readUpTo = end
    }
}

/** The moves that led to this Game or GameResult contract, oldest first. */
export function movesOf(contractId: string): string[] {
    const moves: string[] = []
    for (
        let link = linkTo.get(contractId);
        link;
        link = linkTo.get(link.previous)
    )
        moves.unshift(link.san)
    return moves
}

/** "1. e4 e5 2. Nf3" */
export function movesText(moves: string[]): string {
    return moves
        .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
        .join(' ')
}
