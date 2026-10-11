// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import {
    create,
    exercise,
    init,
    primaryParty,
    queryActive,
    sdk,
} from './ledger'

const COUNTER = '#chess-poc:Counter:Counter'
const app = document.getElementById('app')!
let party = ''

async function render() {
    const counters = await queryActive<{ owner: string; value: string }>(
        party,
        COUNTER
    )
    app.innerHTML = `
        <p>Party: <code>${party}</code></p>
        <button id="new">New counter</button>
        <ul>${counters
            .map(
                (c) =>
                    `<li>${c.payload.value} <button data-cid="${c.contractId}">+1</button></li>`
            )
            .join('')}</ul>
        <pre id="log"></pre>`
    app.querySelector('#new')!.addEventListener('click', () =>
        run(() => create(party, COUNTER, { owner: party, value: '0' }))
    )
    app.querySelectorAll<HTMLButtonElement>('button[data-cid]').forEach((b) =>
        b.addEventListener('click', () =>
            run(() => exercise(party, COUNTER, b.dataset.cid!, 'Increment'))
        )
    )
}

async function run(f: () => Promise<unknown>) {
    try {
        await f()
    } catch (e) {
        console.error(e)
        alert(String((e as Error).message ?? e))
    }
    await render()
}

async function main() {
    await init()
    app.innerHTML = '<button id="connect">Connect wallet</button>'
    const start = async () => {
        party = await primaryParty()
        await render()
    }
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
main()
