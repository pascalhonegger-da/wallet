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

type Json = Record<string, unknown>

async function api(
    requestMethod: 'get' | 'post',
    resource: string,
    body?: Json
) {
    const res = await sdk.ledgerApi({ requestMethod, resource, body } as never)
    const r = res as unknown as { response?: unknown }
    return typeof r.response === 'string'
        ? JSON.parse(r.response)
        : (r.response ?? res)
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

const submit = (party: string, command: Json) =>
    sdk.prepareExecuteAndWait({
        commandId: crypto.randomUUID(),
        actAs: [party],
        commands: [command],
    } as never)

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

/** Primary account via the CIP-103 provider (the high-level SDK has no wrapper for it in this checkout). */
export async function primaryParty(): Promise<string> {
    const provider = sdk.getConnectedProvider()
    if (!provider) throw new Error('not connected')
    const account = await provider.request({ method: 'getPrimaryAccount' })
    return account.partyId
}

export { sdk }
