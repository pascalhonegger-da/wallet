// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Chess } from 'chess.js'

export type Turn = 'White' | 'Black'

function load(fen: string): Chess | null {
    try {
        return new Chess(fen)
    } catch {
        return null
    }
}

export const turnOf = (fen: string): Turn =>
    fen.split(' ')[1] === 'w' ? 'White' : 'Black'

export const fullmoveOf = (fen: string): string => fen.split(' ')[5] ?? '1'

/** Piece placement only. */
export const placementOf = (fen: string): string => fen.split(' ')[0]

export type MoveCheck =
    { ok: true; san: string } | { ok: false; reason: string }

/** Is from->to legal in this position? If so, return the SAN to submit (a pawn reaching the last rank queens). */
export function checkMove(fen: string, from: string, to: string): MoveCheck {
    const chess = load(fen)
    if (!chess) return { ok: false, reason: 'Cannot read this position.' }
    if (!chess.get(from as never))
        return {
            ok: false,
            reason: `Illegal move: there is no piece on ${from}.`,
        }
    const move = chess
        .moves({ square: from as never, verbose: true })
        .find((m) => m.to === to && (!m.promotion || m.promotion === 'q'))
    if (!move) {
        const why = chess.inCheck() ? ' You are in check.' : ''
        return {
            ok: false,
            reason: `Illegal move: that piece cannot go from ${from} to ${to}.${why}`,
        }
    }
    return { ok: true, san: move.san }
}

/** A short note on the position ("X is in check"), or '' if there is nothing to report. The ledger ends the game by
 * itself on checkmate, stalemate, repetition and so on, so only a check needs a note. */
export function positionNote(fen: string): string {
    const chess = load(fen)
    return chess?.inCheck() ? `${turnOf(fen)} is in check.` : ''
}

/** Legal destination squares per square for the side to move (chessground's `dests`). */
export function destsOf(fen: string): Map<string, string[]> {
    const dests = new Map<string, string[]>()
    for (const m of load(fen)?.moves({ verbose: true }) ?? [])
        dests.set(m.from, [...(dests.get(m.from) ?? []), m.to])
    return dests
}
