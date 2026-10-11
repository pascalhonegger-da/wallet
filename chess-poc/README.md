# Canton Chess (joke PoC)

On-chain chess on a local Canton node, written in Daml, played through a small web app that talks to the
**Wallet Gateway** using the **dApp SDK** (CIP-0103). Everything runs locally without Docker. Security and polish
were explicitly not goals.

```
browser ── dApp SDK ──► Wallet Gateway :3030 ──► Canton 3.6 sandbox (JSON Ledger API :7575)
   │                         │  (signs with party keys, self-issued tokens)
   └── static app :5173      └── mock OAuth :8889 (admin identity only)
```

## What it does

- **Challenge**: a player challenges another (choosing their colour). A `lobby` party observes every challenge,
  so the lobby view shows all open challenges.
- **Accept** creates a `Game` with both players as signatories and white/black assigned. Decline / cancel are
  also available.
- **Play**: drag pieces on a chessboard.js board (or type squares under "text board / type a move"). `Move` is a
  consuming choice that archives the game and creates the next version. It is turn-based.
- **Resign**, and **draw offers** (offer / accept / decline / retract). Finished games become a `GameResult`.
- The page polls the ledger every 2 seconds, so both players see updates without reloading.

**No chess rules are enforced.** `Move` only checks that it is your turn, that the origin square holds one of
your pieces, and that origin and target differ. Anything else (illegal moves, captures of your own pieces,
check, castling, ...) is allowed. Milestone 5 (validation, clock) was not built.

## Prerequisites

- Java (tested with 25) and Node 24 with pnpm, as for the rest of this repo.
- `dpm` with SDK 3.6.0 (`dpm install 3.6.0`). The scripts pin it with `DPM_SDK_VERSION=3.6.0`.
  Canton 3.6 is required: self-issued (`party-jwt`) tokens only exist from 3.6.
- Headless Chromium for Playwright (used by `up.sh` to onboard the players, and by the e2e scripts).
- The workspace packages must be built once. `docs/CONTRIBUTING.md` documents `pnpm install` then
  `pnpm build:all`; this PoC was developed with targeted builds instead
  (`pnpm nx build @canton-network/wallet-gateway-remote` and `pnpm --filter @canton-network/dapp-sdk build`),
  so `build:all` itself is untested here.

    The prebuilt `dist/` folders in a checkout can be stale; a stale gateway failed against Canton 3.6 with
    `Missing required field at 'commandId'` until it was rebuilt.

## Run, reset, stop

```bash
chess-poc/scripts/up.sh      # start everything, deploy the DAR, onboard alice/bob/lobby
chess-poc/scripts/reset.sh   # wipe all state and start again (the ledger is in-memory)
chess-poc/scripts/down.sh    # stop everything
```

`up.sh` takes a couple of minutes. It starts the mock OAuth server, the Canton sandbox, the gateway, builds and
serves the web app, and onboards three self-issued users (`alice`, `bob`, `lobby`) by driving the gateway UI
headlessly. Override the list with `CHESS_USERS="alice bob carol lobby" up.sh`. Logs are in `chess-poc/.run/`.

Resources, measured for the Canton sandbox alone: about 1.3 GB RAM, near-zero CPU when idle (a few hundred percent
for ~30 s at startup). Total for the stack was not separately measured.

## Playing a game in two browsers

The services listen on all interfaces. From the sandbox host publish the two ports a browser needs (the ledger
stays internal):

```bash
sbx ports <sandbox-name> --publish 5173:5173/tcp
sbx ports <sandbox-name> --publish 3030:3030/tcp
```

(`<sandbox-name>` is `$SANDBOX_NAME` inside the sandbox.) Then use two browsers, or one normal and one private
window, both on **http://localhost:5173**. The app and the gateway must be reached as `localhost` (the gateway URL
and allowed origin are `localhost`).

1. Click **Connect wallet**, pick **Local Gateway**. In the gateway popup enter a username (`alice` in one
   browser, `bob` in the other) and click Connect, then **Select** on the authentication party.
2. Alice picks bob and a colour, clicks **Challenge**, and approves the transaction in the gateway popup.
   Every action goes through that approval page (Approve / Reject).
3. Bob sees the challenge within ~2 s and clicks **Accept**.
4. Play by dragging pieces. A move snaps back and appears once the transaction is confirmed.
5. Use `lobby` in a third window to watch the open challenges.

If you use any other username than the onboarded ones, the gateway will ask you to create an authentication
party on first login, but the app only offers the players listed in `web/public/config.json` as opponents.

## Tests

```bash
chess-poc/scripts/test-daml.sh          # Daml script tests (separate daml-test package)
node chess-poc/scripts/e2e-counter.mjs  # milestone 1: counter signed via the gateway
node chess-poc/scripts/e2e-challenge.mjs# challenges, accept, lobby, polling
node chess-poc/scripts/e2e-game.mjs     # moves (all by dragging on the board), draw offers, resignation
node chess-poc/scripts/e2e-race.mjs     # lost races and double clicks
```

The e2e scripts need the stack up. They do not clean up after themselves, and `e2e-game` and `e2e-race` assume an
empty ledger (leftover games make their selectors ambiguous), so run each of those straight after `reset.sh`.
`e2e-counter` and `e2e-challenge` tolerate leftovers. In the final run all four passed (game and race on a freshly reset stack, counter and challenge on a used one).

## Layout

```
daml/          Chess.daml (Challenge, Game, GameResult) and Counter.daml (milestone 1); the DAR
daml-test/     Daml script tests, a separate package that depends on the built DAR
gateway/       sandbox auth config and the gateway config template (filled in by up.sh)
web/           the dApp: Vite + TypeScript, dApp SDK, chessboard.js
scripts/       up/down/reset, deploy-dar, onboard (headless), e2e checks
```

## Problems hit and decisions

- **Canton version.** The default `dpm` SDK was 3.5.x. `party-jwt` (self-issued tokens) needs 3.6, so the
  sandbox is pinned to 3.6. `dpm sandbox` also rejects `--bootstrap`, so users are created by onboarding rather
  than by a script.
- **Token audience.** Canton's default audience contains the participant id, which changes on every in-memory
  reset. The mock OAuth identity (used only for the gateway's admin calls) uses a fixed audience
  (`target-audience` in `gateway/sandbox-auth.conf`); the self-issued audience _is_ the participant id, so
  `up.sh` fills it, and the synchronizer id, into the gateway config at startup.
- **Mock OAuth.** It is used only for `participant_admin`. It has no login form: the identity is the
  `clientId`, which is why self-issued tokens (a free username) are better for several players.
- **Workspace dependencies.** The web app depends on the workspace `@canton-network/dapp-sdk` and the gateway runs
  from `wallet-gateway/remote/dist`, per the "consume, don't fork" constraint. chessboard.js and jQuery were
  added to the root `pnpm-workspace.yaml` catalog (catalog mode is strict).
- **Vite dev server breaks the wallet picker.** The SDK serialises a class into a popup and the dev server's
  renamed identifiers (`Vi is not defined`) break it. The app is therefore always built and served with
  `vite preview`.
- **dApp SDK vs docs.**
    - The docs list `getPrimaryAccount()` but the SDK has no such high-level method (the SDK's own integration
      tests carry a TODO for it). The app uses `listAccounts()` and picks the entry marked `primary`, as the
      examples do, and re-reads it on `accountsChanged`.
    - `ledgerApi` is documented with `'GET'` and a JSON string under `.response`; the gateway only accepts
      lowercase `get`/`post` and returns the parsed object. The wrapper accepts both shapes.
    - `prepareExecute` returns before the transaction is done; the app waits for the matching `commandId` in the
      documented `onTxChanged` event.
- **Canton 3.6 JSON API.** Active-contract queries must use `eventFormat`; the old `filter`/`verbose` fields are
  disabled. Optional Daml fields that are `None` are omitted from the JSON, not sent as `null`.
- **Process hygiene.** `pkill -f` patterns can match the shell that runs them; `down.sh` uses `[x]` patterns for
  that reason. Run `reset.sh` as a single command: interleaved runs leave a ledger user without a gateway wallet
  (`Self-issued login is not available for this user.`).
- **Draw offers live on the Game**, not as a separate contract, so archiving the game on every move can never
  leave a stale offer behind.
- **Unexplained once:** during one aborted e2e run the gateway's Approve button stayed disabled. It did not
  reproduce on a clean stack, so it is not understood.
- **Lost races** (acting on a contract the other side just consumed) are reported as a "too late" message and the
  view is refreshed; a double click submits once.

## Not done

- Move validation and the chess clock (milestone 5).
- Streaming instead of polling.
- Any cleanup of finished games / results, or a way to find other players than the configured ones.
