// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { api, queryActive } from './ledger'
import { transactions } from './history'

type Json = Record<string, unknown>
const TEMPLATES = ['Player', 'Challenge', 'Game', 'GameResult']

const short = (id: unknown) =>
    typeof id === 'string' && id.length > 24
        ? `${id.slice(0, 10)}…${id.slice(-6)}`
        : id

/** Raw ledger state for the console: `chessDebug.contracts()` and `chessDebug.events()`. */
export function installDebug(getParty: () => string) {
    const debug = {
        help() {
            console.log(
                [
                    'chessDebug.contracts()  active contracts visible to you (table + raw JSON returned)',
                    'chessDebug.events()     every ledger event you can see, oldest first (table + raw JSON returned)',
                    'chessDebug.raw(path, body?)  GET (or POST with a body) a JSON Ledger API path through the wallet gateway, e.g. "/v2/state/ledger-end"',
                    'Contract ids are shortened in the tables; the returned objects have them in full.',
                ].join('\n')
            )
        },
        async contracts() {
            const party = getParty()
            const all = []
            for (const t of TEMPLATES)
                for (const c of await queryActive<Json>(
                    party,
                    `#chess-poc:Chess:${t}`
                ))
                    all.push({
                        template: t,
                        contractId: c.contractId,
                        ...c.payload,
                    })
            console.table(
                all.map((c) => ({
                    ...c,
                    contractId: short(c.contractId),
                    positions: undefined,
                }))
            )
            console.log(
                `viewing as ${party}; the 'positions' column is omitted from the table, see the returned objects`
            )
            return all
        },
        async events() {
            const party = getParty()
            const { offset: end } = await api('get', '/v2/state/ledger-end')
            const rows: Json[] = []
            for (const tx of await transactions(party, 0, end))
                for (const e of tx.events) {
                    const created = (e.CreatedEvent ?? undefined) as
                        Json | undefined
                    const ex = (e.ExercisedEvent ?? undefined) as
                        Json | undefined
                    const ev = (created ?? ex) as Json
                    rows.push({
                        offset: tx.offset,
                        time: tx.effectiveAt,
                        event: created ? 'Created' : 'Exercised',
                        template: String(ev.templateId ?? '')
                            .split(':')
                            .slice(1)
                            .join(':'),
                        choice: ex?.choice,
                        consuming: ex?.consuming,
                        actors: (ex?.actingParties as string[] | undefined)
                            ?.map((p) => p.split('::')[0])
                            .join(','),
                        contractId: ev.contractId,
                        argument: created
                            ? created.createArgument
                            : ex?.choiceArgument,
                        result: ex?.exerciseResult,
                    })
                }
            console.table(
                rows.map((r) => ({
                    ...r,
                    contractId: short(r.contractId),
                    argument: JSON.stringify(r.argument),
                    result: JSON.stringify(r.result),
                }))
            )
            return rows
        },
        raw: (path: string, body?: Json) =>
            body ? api('post', path, body) : api('get', path),
    }
    Object.assign(window, { chessDebug: debug })
    console.info(
        'Canton Chess: type chessDebug.help() for raw ledger state (contracts and events).'
    )
}
