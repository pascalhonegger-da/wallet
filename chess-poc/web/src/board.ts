// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import '@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.css'

type Position = Record<string, string>
type ChessboardFn = (
    el: HTMLElement | string,
    cfg: object
) => { destroy(): void }

let ctor: Promise<ChessboardFn> | undefined
function chessboard(): Promise<ChessboardFn> {
    ctor ??= (async () => {
        const jq = (await import('jquery')).default
        Object.assign(window, { jQuery: jq, $: jq })
        await import('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.js')
        return (window as unknown as { Chessboard: ChessboardFn }).Chessboard
    })()
    return ctor
}

// No piece images ship with the package: draw the unicode glyphs as inline SVG.
const GLYPHS: Record<string, string> = {
    K: '♚',
    Q: '♛',
    R: '♜',
    B: '♝',
    N: '♞',
    P: '♟',
}
function pieceTheme(piece: string) {
    const white = piece[0] === 'w'
    const svg =
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 45 45'>` +
        `<text x='22.5' y='36' font-size='38' text-anchor='middle' ` +
        `fill='${white ? '#fff' : '#000'}' stroke='${white ? '#000' : '#fff'}' stroke-width='${white ? 1.2 : 0.4}'>` +
        `${GLYPHS[piece[1]]}</text></svg>`
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

export type BoardOptions = {
    position: Position
    orientation: 'white' | 'black'
    /** May the user pick up this piece (e.g. 'wP') right now? */
    canDrag: (piece: string) => boolean
    onMove: (from: string, to: string) => void
}

/** Mount a board. The ledger is the source of truth: a drop always snaps back and shows up on the next poll. */
export async function mountBoard(el: HTMLElement, o: BoardOptions) {
    const Chessboard = await chessboard()
    return Chessboard(el, {
        position: o.position,
        orientation: o.orientation,
        draggable: true,
        pieceTheme,
        onDragStart: (_source: string, piece: string) => o.canDrag(piece),
        onDrop: (source: string, target: string) => {
            if (target !== 'offboard' && source !== target)
                o.onMove(source, target)
            return 'snapback'
        },
    })
}
