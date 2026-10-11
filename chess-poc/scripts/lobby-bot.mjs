// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// The lobby operator. A player's token only reads the player's own party, so registered players cannot see each
// other by themselves: this bot (acting as the internal `lobby` party with the mock-OAuth admin identity) adds every
// registered player as observer of every other player's `Player` contract. Run by up.sh; usage: node lobby-bot.mjs <lobby party>
const LEDGER = 'http://127.0.0.1:7575'
const PLAYER = '#chess-poc:Chess:Player'
const lobby = process.argv[2]
if (!lobby) throw new Error('usage: node lobby-bot.mjs <lobby party id>')

async function token() {
    const r = await fetch('http://127.0.0.1:8889/token', {
        method: 'POST',
        headers: {
            Authorization:
                'Basic ' +
                Buffer.from('participant_admin:admin-client-secret').toString(
                    'base64'
                ),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=daml_ledger_api&audience=https://chess.local',
    })
    return (await r.json()).access_token
}

async function call(tok, method, path, body) {
    const r = await fetch(LEDGER + path, {
        method,
        headers: {
            Authorization: `Bearer ${tok}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    })
    if (!r.ok)
        throw new Error(
            `${method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`
        )
    return r.json()
}

async function players(tok) {
    const { offset } = await call(tok, 'GET', '/v2/state/ledger-end')
    const items = await call(tok, 'POST', '/v2/state/active-contracts', {
        eventFormat: {
            filtersByParty: {
                [lobby]: {
                    cumulative: [
                        {
                            identifierFilter: {
                                TemplateFilter: {
                                    value: {
                                        templateId: PLAYER,
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
        activeAtOffset: offset,
    })
    return items
        .map((i) => i.contractEntry?.JsActiveContract?.createdEvent)
        .filter(Boolean)
        .map((e) => ({
            cid: e.contractId,
            player: e.createArgument.player,
            friends: e.createArgument.friends,
        }))
}

async function pass() {
    const tok = await token()
    const all = await players(tok)
    const names = [...new Set(all.map((p) => p.player))]
    for (const p of all) {
        const missing = names.filter(
            (n) => n !== p.player && !p.friends.includes(n)
        )
        if (!missing.length) continue
        await call(tok, 'POST', '/v2/commands/submit-and-wait', {
            commands: [
                {
                    ExerciseCommand: {
                        templateId: PLAYER,
                        contractId: p.cid,
                        choice: 'Introduce',
                        choiceArgument: { others: missing },
                    },
                },
            ],
            commandId: `introduce-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            actAs: [lobby],
            userId: 'participant_admin',
        })
        console.log(
            `introduced ${missing.map((m) => m.split('::')[0])} to ${p.player.split('::')[0]}`
        )
    }
}

console.log('lobby bot running for', lobby)
for (;;) {
    try {
        await pass()
    } catch (e) {
        console.error(String(e).slice(0, 400))
    }
    await new Promise((r) => setTimeout(r, 1000))
}
