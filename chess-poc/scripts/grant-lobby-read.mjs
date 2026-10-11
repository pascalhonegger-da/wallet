// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Makes the lobby a public party: every ledger user the gateway creates (players, on their first login) is granted
// the CanReadAs right for it. A player's self-issued token takes its rights from the ledger user, so the right
// applies immediately. The gateway has no hook for this, hence this loop (run by up.sh, admin identity from mock OAuth).
// usage: node grant-lobby-read.mjs <lobby party>
const LEDGER = 'http://127.0.0.1:7575'
const lobby = process.argv[2]
if (!lobby) throw new Error('usage: node grant-lobby-read.mjs <lobby party id>')
const done = new Set()

async function pass() {
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
    const headers = {
        Authorization: `Bearer ${(await r.json()).access_token}`,
        'Content-Type': 'application/json',
    }
    const { users } = await (
        await fetch(`${LEDGER}/v2/users`, { headers })
    ).json()
    for (const u of users.filter((u) => u.primaryParty && !done.has(u.id))) {
        const rights = await fetch(`${LEDGER}/v2/users/${u.id}/rights`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                userId: u.id,
                identityProviderId: '',
                rights: [{ kind: { CanReadAs: { value: { party: lobby } } } }],
            }),
        })
        if (!rights.ok)
            throw new Error(
                `grant for ${u.id}: ${rights.status} ${await rights.text()}`
            )
        done.add(u.id)
        console.log(`${u.id} may now read as the lobby`)
    }
}

for (;;) {
    await pass().catch((e) => console.error(String(e).slice(0, 300)))
    await new Promise((r) => setTimeout(r, 1000))
}
