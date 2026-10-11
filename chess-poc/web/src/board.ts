// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Chessground is the board library of lichess; the css brings its board and the cburnett piece set.
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

export type BoardOptions = {
    /** The full FEN (chessground only reads the piece placement). */
    fen: string
    orientation: 'white' | 'black'
    /** Legal destinations per square when it is this player's turn, otherwise undefined (board is view-only). */
    dests?: Map<string, string[]>
    color: 'white' | 'black'
    /** Called after the user dropped a piece. The ledger is the source of truth: once it returns, the board is reset
     * to the last known ledger position (a successful move arrives as a new FEN by polling). */
    onMove: (from: string, to: string) => Promise<void>
}

export function mountBoard(el: HTMLElement, o: BoardOptions): Api {
    const position = o.fen.split(' ')[0]
    const cg: Api = Chessground(el, {
        fen: o.fen,
        orientation: o.orientation,
        coordinates: true,
        viewOnly: !o.dests,
        turnColor: o.color, // chessground does not read the turn from the FEN; without this black moves are premoves
        highlight: { lastMove: false, check: true },
        animation: { duration: 150 },
        movable: {
            free: false,
            color: o.dests ? o.color : undefined,
            dests: o.dests as Map<Key, Key[]> | undefined,
            showDests: true,
            events: {
                after: (from, to) => {
                    void o
                        .onMove(from, to)
                        .finally(() => cg.set({ fen: position }))
                },
            },
        },
        premovable: { enabled: false },
        draggable: { showGhost: true },
    })
    return cg
}
