# Hidden Trump

A four-player, two-team card game with an authoritative Node.js server and a React browser client. State is held in memory. Restarting the server clears rooms, hands and round history.

`Agents.md` is the game specification. The file is currently named with that capitalization on disk; `CLAUDE.md` contains the requested `@AGENTS.md` reference. Windows resolves that reference case-insensitively.

## Run locally

Requires Node.js 22 or newer and npm. Deployment uses Node.js 22, as pinned in `.node-version`.

```sh
npm install
npm run dev
```

This starts both workspaces: Vite on port 5173 and the game server on port 3001. Open `http://localhost:5173`. On another device on the same network, use the computer's LAN address, such as `http://192.168.1.20:5173`. Vite listens on network interfaces and proxies `/socket.io` to the backend. The terminal prints LAN URLs. Local firewall rules must allow the connection.

On Windows, use `npm.cmd` if PowerShell's execution policy blocks `npm.ps1`.

Enter a display name and room code. An unused valid code creates a room; an existing code joins it. Codes are normalized to uppercase alphanumeric characters, 3–8 characters long. A blank or invalid code generates a four-character code. There are no spectator seats.

Joining automatically takes the first free seat. In the lobby, the **Take P1–P4** buttons move you to another open seat, releasing the original one. Seats cannot be changed during a round. P1/P3 form Team A and P2/P4 form Team B. Any seated player can start when all four seats are occupied.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

The Vitest suite includes isolated bidding/trick/scoring tests, seeded deal and redaction tests, rendered React components, session cleanup tests, and integration tests using real Socket.IO connections. It does not run an interactive browser or physical-phone test.

The random-deal regression runs 2,000 seeds, checks all seven active-trump counts occur, rejects excessive concentration, and verifies all 52 cards remain accounted for. The secrecy regression holds the viewer's cards and public state fixed and compares complete pre-reveal payloads under each possible secret suit. Socket tests also check that guessed reveal-card requests cannot use different errors to infer trump.

## Game flow

Round numbering begins at **1**. P1 deals the first round; the dealer rotates one seat on each next round. Turn order is P1 → P2 → P3 → P4. The table rotates to put your seat at the bottom, with subsequent seats clockwise: bottom → left → top → right.

The server shuffles a 52-card deck, Ace high, and deals five cards each starting left of the dealer. Bidding starts there too. Each player gets one bid, 1–13. Only a strictly higher bid takes the lead; lower and equal bids are recorded without changing the leader. A bid of 13 immediately ends the auction.

The taker chooses one of those five cards as the hidden trump. The server deals the remaining 32 cards from the already shuffled deck, starting at the **taker**, then the next three seats, repeating eight times. This produces 12 active cards for the taker, 13 for each other player, and one set-aside card.

### Active-trump cap

After that ordinary deal, the taker's **12 active cards** may contain at most **six** cards of the trump suit. The hidden card is excluded from the cap. If the count is seven or higher, the server randomly selects a newly dealt trump and swaps it with a randomly selected newly dealt non-trump card from the other players. It repeats only until the active count is six. All other cards keep their positions and owners. Swaps are restricted to the eight new cards per player: changing an already-visible bidding card would disclose information about the secret suit. The initial hands, apart from the taker's set-aside card, are preserved.

There is no trump quota, face-card guarantee or reshuffle-until-acceptable loop. A deal already below the cap is unchanged. Counts 0–6 follow ordinary card-deal probabilities with the excess tail capped; their frequencies are not equal. When the hidden card later returns, the taker can consequently hold seven trumps in total.

### Play and revelation

The taker leads first. Follow the led suit whenever possible. While trump is hidden, the leader cannot repeat the preceding trick's led suit, except when their hand contains no alternative suit. The restriction disappears when trump is revealed.

A void player can keep trump hidden and discard, or press **Reveal the trump**. Reveal is an immediate, irreversible server action, separate from playing a card. The server broadcasts the actual trump and returns the set-aside card to the taker's hand, whoever revealed. Only then does it send trump-specific legal moves. The revealer must play a trump if they now hold one; otherwise they may play any card. Their obligation survives a refresh. Other void players, after this revealing turn, may play any card.

The taker may immediately select the returned card or another trump. If they use another trump, the returned card remains in their hand. If their active hand is empty while trump is still hidden, they must reveal first, then select the returned card; this also permits leading trick 13. A reveal cannot be previewed and undone. Selecting **Keep hidden** remains a local choice until a card is submitted; the player can choose to reveal instead before submitting it.

The taker's hidden-trump discard is described as face down. It is redacted from other players' live **and completed** trick-card views; its owner sees it. There is no automatic flip at trick resolution or round end. Non-taker discards are face up. Completed tricks are summarized by winner and sweep in the UI; the server retains the most recent completed trick and a bounded action log.

Before revelation, the highest led-suit card wins. If revelation occurs during a trick, only trump cards played **from the reveal onward** can win as trumps. If there are none, the highest led-suit card across the whole trick wins. On subsequent tricks, any trump beats a non-trump. The winner leads next.

### Sweeps and round outcome

Each trick joins one shared unclaimed pile. The same individual seat must win back-to-back tricks to sweep the entire pile for its team. Before trump is revealed, the second win must be on trick 5 or later. Revelation lifts that floor immediately. An Ace as the second winning card blocks a sweep but preserves the streak. A successful sweep empties the pile and resets the streak; a new pair is required.

Live win checks run after **every trick from trick 1 onward**. The taker's team wins at secured tricks ≥ bid; the opposition wins at secured tricks ≥ `14 − bid`. Early revelation can therefore allow a win before trick 5. The sole deferred check is **trick 12**: if play reaches it, trick 13 must finish. At trick 13 the taker's team wins only if its secured count meets the bid; otherwise the opposition wins. Unswept tricks count for neither team.

The result shows the bid, taker, both secured counts, unclaimed pile, ending trick and reason. Any seated player can start the next round. Previous round summaries remain in server memory.

## Sessions, leaving and cleanup

- A random token in `sessionStorage` identifies a browser tab. It survives refresh. Display name and last room are stored in `localStorage`, shared across tabs. A token reclaims the original seat; a matching disconnected display name is a fallback if the token was lost.
- A refresh or network loss holds the seat for **five minutes**. Rejoining cancels its expiry. After expiry, cleanup releases the identity and makes the seat available. Closing a tab uses this same grace period: the server cannot reliably distinguish a close from a refresh or network failure.
- **Leave** sends an explicit server request that releases the seat immediately, revokes that socket's room session, and returns the client to the landing screen. Switching rooms on the same socket also releases the old seat after the new join succeeds.
- Releasing a seat preserves its cards and turn in an unfinished round. A replacement joining that open seat inherits the hand and continues the round. There are no bots or automatic forfeits; play waits if the absent seat must act.
- Rooms with nobody connected expire after **six hours since the last room activity**, whether or not they have completed-round history. A connected player prevents room expiry. Cleanup runs every **60 seconds**, so seat and room expiry occurs on the first sweep at or after its deadline.
- A newer connection with the same token replaces the older connection's authority. The old connection cannot make game moves, and its later disconnect cannot clear the newer connection's listener or mark its seat disconnected.

For local four-player testing, open independent tabs sequentially: create a room in the first, then join its code in three more. Browsers may copy session storage when duplicating a tab; independently opened tabs avoid copying the seat token. Shared name/room storage means changing them in one tab affects what other tabs read on a later reconnect.

## Code layout and protocol

```text
shared/src/          card helpers and typed client/server payloads
server/src/engine/   authoritative game state and rule functions
server/src/rooms.ts  in-memory rooms, seat expiry and room cleanup
server/src/events.ts socket sessions, validation, per-seat broadcasts
server/src/app.ts    Express static frontend, /health, Socket.IO and cleanup timer
server/src/index.ts  server startup and shutdown
server/test/        engine, rendering and socket integration tests
client/src/         React screens, hand/table UI and socket client
```

Express serves the frontend and health endpoint through a Node HTTP server shared with Socket.IO. Scoring and winner selection are pure functions; the game engine mutates the authoritative room state. Tests inject seeded random sources; runtime dealing uses `Math.random`.

`viewFor` builds a separate payload for each seat. It includes that player's active hand, public state and other players' card counts. Hidden trump-specific card IDs and messages are withheld. `reveal_trump` commits the reveal; `play_card` then submits a card with `reveal: false`. Old combined network requests with `reveal: true` are rejected with a uniform error before inspecting a guessed card. The internal engine still supports atomic reveal-and-play for simulation fixtures.

There are no accounts or durable storage. Reconnection is based on tokens and the disconnected-name fallback, not account authentication.

## Production packaging

```sh
npm ci --include=dev
npm run build
npm start
```

The build produces `client/dist` and `server/dist/index.js`. The server bundle includes shared TypeScript code, and `npm start` runs the compiled JavaScript with Node; it does not require `tsx` at runtime. Build tools require development dependencies during the build. Production dependencies are still required at runtime.

The backend serves the built website at `/`, assets from `client/dist`, `/health`, and Socket.IO on a single port (3001 by default). Production startup fails clearly if the frontend has not been built. The client connects to the page's origin, starts with HTTP polling, and upgrades to WebSocket where available. No separate frontend host or API URL is needed. Source files are not served.

`PORT` sets the server port and Vite's development proxy target. The server binds to `0.0.0.0`. `CLIENT_PORT` only changes the client URL printed during development; Vite still uses 5173. Production prints the actual server port. SIGTERM/SIGINT close sockets and the HTTP server.

### Free hosting on Render

`render.yaml` configures one **Free** Node web service in Singapore, with `/health` checks, `NODE_ENV=production`, a build that runs type checking and tests, and `npm start`. After pushing this repository to GitHub, create a Render Blueprint from that repository. Automatic deployment is disabled so a push does not interrupt an active game; deploy later changes manually. Render supplies the public HTTPS URL and supports Socket.IO WebSockets.

Share that public URL and a room code with three friends. Each can join from their own browser on a different network. Four tabs are only a local testing convenience; the game is not limited to one machine. Each device has its own session token, and there are exactly four seats per room.

Render's free service sleeps after 15 minutes without inbound HTTP requests or WebSocket messages, and waking it can take about a minute. The workspace has a shared allowance of 750 free instance hours per month. See [Render's free-service limits](https://render.com/docs/free). Sleeping, restarting or deploying clears all in-memory rooms, regardless of the application's five-minute seat grace and six-hour idle-room timers. Use a single server instance: there is no database or coordination across server processes.

## Interpretations retained

- The hidden card returns to the taker on any reveal, preserving thirteen full four-card tricks.
- An empty-handed taker can reveal while leading the final trick.
- A leader holding only the prohibited previous suit may lead it to avoid a dead end.
- Face-down discards remain redacted in completed views, as described above.
- The clarified live win-check rule is implemented without changes to the scoring thresholds or trick-12 exception.
- Worked example 7 is implemented as the stated sequencing rule: only post-reveal trumps count, with the specified led-suit fallback. Its description of P4 as both void in Hearts and holding a Heart is still inconsistent unless that Heart has just returned to P4 as the taker. Ordinary follow-suit enforcement remains in effect.
