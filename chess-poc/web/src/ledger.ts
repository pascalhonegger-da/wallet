// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import * as sdk from '@canton-network/dapp-sdk'
import { RemoteAdapter } from '@canton-network/dapp-sdk'

export const GATEWAY_DAPP_URL = 'http://localhost:3030/api/v0/dapp'

export async function init() {
    await sdk.init({
        defaultAdapters: [
            new RemoteAdapter({
                name: 'Local Gateway',
                rpcUrl: GATEWAY_DAPP_URL,
            }),
        ],
        enableSuggestedWallets: false,
    })
}

/** The user's primary party. */
export async function primaryParty(): Promise<string> {
    const accounts = await sdk.listAccounts()
    const account = accounts.find((a) => a.primary) ?? accounts[0]
    if (!account) throw new Error('wallet has no parties')
    return account.partyId
}

type Json = Record<string, unknown>

async function api(
    requestMethod: 'get' | 'post',
    resource: string,
    body?: Json
) {
    const res: unknown = await sdk.ledgerApi({ requestMethod, resource, body })
    // The gateway returns the parsed ledger response; the docs show a JSON string under `.response`.
    const wrapped = (res as { response?: unknown }).response
    return typeof wrapped === 'string' ? JSON.parse(wrapped) : (wrapped ?? res)
}

export type Contract<T> = { contractId: string; payload: T }

/** Active contracts of one template visible to `party`. */
export async function queryActive<T>(
    party: string,
    templateId: string
): Promise<Contract<T>[]> {
    const { offset } = await api('get', '/v2/state/ledger-end')
    const items = await api('post', '/v2/state/active-contracts', {
        eventFormat: {
            filtersByParty: {
                [party]: {
                    cumulative: [
                        {
                            identifierFilter: {
                                TemplateFilter: {
                                    value: {
                                        templateId,
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
    return (items as Json[])
        .map(
            (i) =>
                (i.contractEntry as Json | undefined)?.JsActiveContract as
                    Json | undefined
        )
        .filter((c): c is Json => !!c)
        .map((c) => {
            const ev = c.createdEvent as {
                contractId: string
                createArgument: T
            }
            return { contractId: ev.contractId, payload: ev.createArgument }
        })
}

/** prepareExecute, resolved once the gateway reports this command as executed (rejects on failure). */
async function submit(party: string, command: Json): Promise<void> {
    const commandId = crypto.randomUUID()
    let listener: Parameters<typeof sdk.onTxChanged>[0] | undefined
    const done = new Promise<void>((resolve, reject) => {
        listener = (e) => {
            if (e.commandId !== commandId) return
            if (e.status === 'executed') resolve()
            if (e.status === 'failed')
                reject(new Error('transaction failed or was rejected'))
        }
    })
    await sdk.onTxChanged(listener!)
    try {
        await sdk.prepareExecute({
            commandId,
            actAs: [party],
            commands: [command],
        } as never)
        await done
    } finally {
        await sdk.removeOnTxChanged(listener!)
    }
}

export const create = (
    party: string,
    templateId: string,
    createArguments: Json
) => submit(party, { CreateCommand: { templateId, createArguments } })

export const exercise = (
    party: string,
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Json = {}
) =>
    submit(party, {
        ExerciseCommand: { templateId, contractId, choice, choiceArgument },
    })

export { sdk }
