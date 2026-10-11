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

- **Sign up** (self-service): nobody exists after a reset. A new player connects through the wallet (the gateway
  creates their party on first login), then clicks **Create chess account**, which creates a `Player` contract signed
  by them. Registered players appear in each other's opponent list, which grows as people sign up.
- **Challenge**: a player challenges another (choosing their colour). The `lobby` party observes every challenge.
- **Accept** creates a `Game` with both players as signatories and white/black assigned. Decline / cancel are
  also available.
- **Play**: drag pieces on a [Chessground](https://github.com/lichess-org/chessground) board (the lichess board library, GPL-3.0; it only offers legal moves). `Move` is a
  consuming choice that archives the game and creates the next version. It is turn-based.
- **Resign**, and **draw offers** (offer / accept / decline / retract). Finished games become a `GameResult`.
- **Look back**: click any move in the move list (or use the ⏮ ◀ ▶ ⏭ buttons) to see the board as it was then. The shown
  move is highlighted and the board is view-only until you are back on the latest move. No variants.
- **Past games**: finished games are listed under Results; **Open** shows a replayable board with the moves.
- **Raw ledger state**: open the browser console and run `chessDebug.contracts()` (active contracts) or
  `chessDebug.events()` (every created contract and exercised choice you can see, with arguments and results).
  `chessDebug.help()` lists the rest. Both print a table and return the full objects.
- The page polls the ledger every 2 seconds, so both players see updates without reloading.

## How the rules work

The game state is one **FEN** string (`Game.fen`). `Move` takes the move in **standard algebraic notation**
(`e4`, `Nbd7`, `exd5`, `e8=Q`, `O-O`; check/mate suffixes and long forms like `e2e4` are accepted) and Daml computes
the next FEN. So the ledger enforces the rules, not just the UI: it generates all legal moves (including pins,
castling rights and not castling through check, en passant, promotion) and resolves the SAN to exactly one of
them, rejecting illegal or ambiguous moves. The web app also uses chess.js on the same FEN, but only for
immediate feedback and to produce the SAN it submits; another client could not cheat.

The move generator is checked against the published perft node counts for six standard positions
(`daml-test`), which exercise castling, en passant, promotion and pins.

**The game ends by itself** (a `GameResult` is created instead of the next `Game`) on checkmate, stalemate,
insufficient material (bare kings, or one knight/bishop against a bare king), threefold repetition and the 75-move
rule. Players can also resign or agree a draw. Not implemented: claiming a draw under the 50-move rule, and the
chess clock.

## What is stored where

- **Ledger contracts**: `Player` (player, lobby, friends), `Challenge` (creator, opponent, lobby, colour), `Game` (white, black, `fen`,
  `drawOfferedBy`, `positions`) and `GameResult` (white, black, final `fen`, outcome, reason). Every move archives
  the `Game` and creates the next version, so a move is one consuming `Move` exercise.
- **`positions`** (in `Game`) counts how often each position occurred since the last pawn move or capture. It is the
  only history kept in a contract, because a choice cannot read archived contracts and threefold repetition needs it.
- **Move history** is _not_ stored in the contracts. The ledger already keeps every exercised `Move` event with its
  `san` argument and the contract it created; `web/src/history.ts` reads them from `/v2/updates` (through the
  gateway's `ledgerApi`) and follows the chain back from a game or result.
- **Wallet Gateway**: sessions, the party-to-user mapping and the party signing keys (its `wallet-kernel` provider).
- **Browser**: nothing persistent. The board is drawn from the FEN; the lobby party id comes from `web/public/config.json`.

On a move, the page asks chess.js for the SAN, the SDK's `prepareExecuteAndWait` sends `Move {actor, san}`, the
gateway prepares the transaction (this is where Daml runs the rules; an illegal move fails here and no approval
window opens), you approve it in the gateway popup, the gateway signs with your party key and executes it. Only the
mover signs: a consuming choice runs with the authority of the contract's signatories, so the new `Game`, which
has both players as signatories, is authorised. The other page sees it on its next 2 second poll.

## How players find each other

A player's self-issued token only lets them read their own party, so there is no public party all players could
read. Sign-up therefore works through an operator: the `lobby`, an internal party (allocated by `up.sh`, no
gateway login) run by `scripts/lobby-bot.mjs`. A `Player` contract is signed by the player and has the lobby as
observer. The bot notices new ones and exercises `Introduce` to add every registered player to every other
player's `friends` (observers), after which they can see each other's contracts, so the opponent dropdown fills up. The bot acts
as the lobby through the mock-OAuth admin user (`up.sh` grants it `CanActAs` on the lobby). Introductions take
about a second.

## Prerequisites

- Java (tested with 25) and Node 24 with pnpm, as for the rest of this repo.
- `dpm` with SDK 3.6.0 (`dpm install 3.6.0`). The scripts pin it with `DPM_SDK_VERSION=3.6.0`.
  Canton 3.6 is required: self-issued (`party-jwt`) tokens only exist from 3.6.
- Headless Chromium for Playwright (used by the e2e scripts).
- The workspace packages must be built once. `docs/CONTRIBUTING.md` documents `pnpm install` then
  `pnpm build:all`; this PoC was developed with targeted builds instead
  (`pnpm nx build @canton-network/wallet-gateway-remote` and `pnpm --filter @canton-network/dapp-sdk build`),
  so `build:all` itself is untested here.

    The prebuilt `dist/` folders in a checkout can be stale; a stale gateway failed against Canton 3.6 with
    `Missing required field at 'commandId'` until it was rebuilt.

## Run, reset, stop

```bash
chess-poc/scripts/up.sh      # start everything and deploy the DAR (no players: they sign up themselves)
chess-poc/scripts/reset.sh   # wipe all state and start again (the ledger is in-memory)
chess-poc/scripts/down.sh    # stop everything
```

`up.sh` takes a couple of minutes. It starts the mock OAuth server, the Canton sandbox, the gateway, builds and
serves the web app, creates the internal `lobby` party and starts the lobby bot (see "How players find each other").
Logs are in `chess-poc/.run/`.

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
   browser, `bob` in the other) and click Connect. A first-time user is taken through the gateway's onboarding page:
   enter any wallet name, keep the signing provider selection (`wallet-kernel`), click **Create party**. A returning
   user clicks **Select** on their party instead.
2. Click **Create chess account** and approve the transaction. You now see the lobby and the other players.
3. Alice picks bob and a colour, clicks **Challenge**, and approves the transaction in the gateway popup.
   Every action goes through that approval page (Approve / Reject).
4. Bob sees the challenge within ~2 s and clicks **Accept**.
5. Play by dragging pieces. A move snaps back and appears once the transaction is confirmed.

## Tests

```bash
chess-poc/scripts/test-daml.sh          # Daml script tests (separate daml-test package), incl. perft counts
node chess-poc/scripts/e2e-signup.mjs   # self-service sign-up and the lobby bot (needs an empty ledger)
node chess-poc/scripts/e2e-challenge.mjs# challenges, accept, what the lobby sees, polling
node chess-poc/scripts/e2e-game.mjs     # moves on the board, an illegal move, mate note, castling, draws, resignation
node chess-poc/scripts/e2e-views.mjs    # looking back at positions, opening past games, the console helpers
node chess-poc/scripts/e2e-race.mjs     # lost races and double clicks
node chess-poc/scripts/e2e-ledger.mjs   # cheating client, reject/abandon approvals, en passant, check handling
```

The e2e scripts need the stack up. They do not clean up after themselves, and `e2e-game`, `e2e-race`, `e2e-views` and
`e2e-ledger` assume an empty ledger (leftover games make their selectors ambiguous), so run each of those straight
after `reset.sh`. `e2e-challenge` tolerates leftovers. The session-expiry UI (Reconnect banner) is not covered by an e2e test. They drive headless Chromium, so none of this has been seen in a real desktop browser.
The page has a few test hooks on `window.__chess` (pause polling, shorten the approval timeout, submit a move
without the UI's own rule check); they are not used by normal play.

## Layout

```
daml/          Chess.daml (Challenge, Game, GameResult); the DAR
daml-test/     Daml script tests, a separate package that depends on the built DAR
gateway/       sandbox auth config and the gateway config template (filled in by up.sh)
web/           the dApp: Vite + TypeScript, dApp SDK, Chessground, chess.js
scripts/       up/down/reset, deploy-dar, the lobby bot, e2e checks
```

## Problems hit and decisions

- **Canton version.** The default `dpm` SDK was 3.5.x. `party-jwt` (self-issued tokens) needs 3.6, so the
  sandbox is pinned to 3.6. `dpm sandbox` also rejects `--bootstrap`, so users are created by the gateway's
  onboarding (the player's first login) rather than by a script.
- **Token audience.** Canton's default audience contains the participant id, which changes on every in-memory
  reset. The mock OAuth identity (used only for the gateway's admin calls) uses a fixed audience
  (`target-audience` in `gateway/sandbox-auth.conf`); the self-issued audience _is_ the participant id, so
  `up.sh` fills it, and the synchronizer id, into the gateway config at startup.
- **Mock OAuth.** It is used only for `participant_admin`. It has no login form: the identity is the
  `clientId`, which is why self-issued tokens (a free username) are better for several players.
- **Workspace dependencies.** The web app depends on the workspace `@canton-network/dapp-sdk` and the gateway runs
  from `wallet-gateway/remote/dist`, per the "consume, don't fork" constraint. Chessground was
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
- **Sessions last 10 minutes.** The gateway issues self-issued access tokens with a 10 minute lifetime and does
  not refresh them. After that the ledger calls fail; the page then shows "the session may have expired" with a
  **Reconnect** button (login popup again) and refuses actions with an explanation instead of hanging.
- **Closing the approval window** without approving or rejecting leaves the SDK waiting (its timeout is 5 minutes).
  The app gives up after 90 seconds with a message and unlocks the page; approving later still works and shows up.
- **Rejecting in the wallet** asks for a browser `confirm()`; a headless test must accept it.
- **Daml has no local recursion**: recursive helpers must be top level. Also `DA.Text` has no case conversion.
- **Draw offers live on the Game**, not as a separate contract, so archiving the game on every move can never
  leave a stale offer behind.
- **Unexplained once:** during one aborted e2e run the gateway's Approve button stayed disabled. It did not
  reproduce on a clean stack, so it is not understood.
- **Lost races** (acting on a contract the other side just consumed) are reported as a "too late" message and the
  view is refreshed; a double click submits once.

## Not done

- The chess clock (the move validation half of milestone 5 is done, on the ledger) and claiming a draw under the
  50-move rule (only the automatic 75-move rule exists).
- Refreshing the 10 minute session automatically; today the player reconnects when the page asks.
- Streaming instead of polling.
- Any cleanup of finished games / results, or a way to find other players than the configured ones.
