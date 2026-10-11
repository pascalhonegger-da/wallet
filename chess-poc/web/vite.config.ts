// Copyright (c) 2025-2026 Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite'

// 5173 is the origin the gateway config allows (chess-poc/gateway/config.template.json).
export default defineConfig({ server: { port: 5173, host: '0.0.0.0' } })
