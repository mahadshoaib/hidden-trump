# Build: "Hidden Trump" — 4-player online card game

Build a real-time multiplayer web app for a custom trick-taking card game called **Hidden Trump**. 4 players join a shared room from their own devices (phone/laptop browsers) and play a full round together. Prioritize correctness of game logic over visual polish, but the UI should be clean, mobile-friendly, and usable one-handed on a phone.

## Tech stack (recommended, adjust if you have a better default)
- **Backend:** Node.js + TypeScript, Express + Socket.IO (authoritative game state lives server-side; this is critical — see "Anti-cheat / hidden information" below).
- **Frontend:** React + TypeScript + Vite, Socket.IO client. Plain CSS or Tailwind, your call.
- **State:** In-memory per-room game state on the server (a Map<roomCode, GameState>) is fine for v1 — no database needed. Structure it so a persistence layer (Redis/Postgres) could be swapped in later without a rewrite.
- **Deployment target:** should run locally with `npm run dev` for both server and client, single command ideally (concurrently or a root script).

## Why a real backend, not just a shared client-side store
The trump card and each player's hand must be genuinely hidden from other players and from anyone inspecting network traffic / client state — not just hidden in the UI. The server is the single source of truth: it holds the full deck and all hands, and only ever sends each client (a) their own hand, (b) public information (whose turn, cards played this trick, bids, revealed trump if applicable, scores), and (c) card-back counts for other players' hands. Never send another player's hand contents or the face-down trump card to a client before it's legitimately revealed.

---

## Full game rules

**Players & setup**
- 4 players, fixed 2v2 partnerships by seat: seats P1 & P3 are Team A, P2 & P4 are Team B. Partners sit "across" from each other.
- Standard 52-card deck. Rank order low→high: 2,3,4,5,6,7,8,9,10,J,Q,K,A (Ace high).
- Deal 5 cards to each player to start.

**Bidding**
- Bidding starts as soon as the initial 5 cards are dealt to everyone — each player is bidding purely off what they see in that 5-card hand, before anything else is dealt.
- Starting from the seat left of the dealer, players bid in turn, one at a time. This is an **ascending auction**, not independent simultaneous bids:
  - The first bidder states any number from 1–13.
  - Each subsequent player, to actually take over as the leading bidder, must bid a number **strictly higher** than the current highest bid. (A bid that isn't higher just doesn't change who's leading — record it, but the standing high bidder stays in front.)
  - **Short-circuit:** if any player bids **13** (the maximum possible — all 13 tricks), bidding stops immediately at that instant. No remaining players get a turn, since nobody could ever legally bid higher. That player is the taker outright.
  - Otherwise, once all 4 players have had their turn, whoever ended up with the highest recorded bid is the taker. (Because each new leading bid must be strictly higher than the last, there's no tie to break — ties simply can't occur among leading bids under this ascending format.)
- The taker's team is the **taker's team**; the other team is the **opposition**.

**Setting the trump**
- The taker removes ONE card from their 5-card hand and places it face-down on the table — this is the secret trump card. Its suit is not revealed to anyone, including partners, until a reveal event happens (see below).
- **Trump-count cap:** the taker's final 12-card active hand may never end up with more than 6 cards of the trump suit. This is a cap, not a guarantee — the taker can end up with anywhere from 0 to 6 trump-suit cards in their active hand, and that outcome should still be genuinely random within that 0–6 range, not biased toward any particular number (6 included). If an unconstrained random deal would have given the taker 7 or more, redistribute just enough of the excess trump cards to other players (swapped for non-trump cards of theirs) to bring the taker back to 6 — everything else about the deal stays as uniformly random as an unconstrained deal would be.
- The rest of the deck is then dealt out, **starting from the taker's seat and proceeding around the table in turn order** (taker, then next seat, then next, then next, repeating), so every player ends up with 13 *active* cards to play from — **except the taker, who ends up with only 12 active cards** (the 13th is that hidden trump card, sitting outside their hand until it's revealed — see "The trump reveal mechanic" for how it returns to play). Total cards dealt into active hands: 12 (taker) + 13×3 (others) = 51, plus the 1 hidden card = 52. This must balance exactly, or the round can't produce 13 full 4-card tricks.
- The taker leads the first trick.

**Leading restriction (only while trump is still hidden)**
- Whoever leads a trick may not lead the same suit that was led on the immediately preceding trick. This restriction is lifted permanently the moment trump is revealed (even mid-round).

**Following suit**
- Standard trick-taking: a player must follow the led suit if they hold any card of that suit.
- A player who holds none of the led suit is **void** and their options depend on whether trump has been revealed yet (see next section).

**The trump reveal mechanic**
- This only matters while the trump is still hidden. Once revealed, it stays revealed for the rest of the round.
- Any player — including the taker — who is void in the led suit gets a choice at that moment:
  - **Reveal:** flip the secret trump card face-up for everyone to see (this fixes the trump suit for the rest of the round). Having chosen to reveal, that player is then *obligated* to play a card of the trump suit as their card for this trick, if they can.
    - **Non-taker revealing:** must play a trump-suit card from their own hand if they hold one; if they hold zero, let them play any card (don't soft-lock).
    - **Taker revealing:** the taker's hidden trump card itself returns to play at this moment, becoming part of their hand. The taker always has the option to play — as their card for this trick — either that just-revealed card directly, or any other trump-suit card they happen to already hold in their active hand. **The taker can always legally choose "reveal," even if their active 12-card hand contains zero cards of the trump suit**, because the returning hidden card itself counts as a trump card they can play to satisfy the obligation.
    - If the taker reveals but chooses to hold the returned trump card back for a later trick instead of playing it immediately, that's fine as long as they play some other trump card right now — the returned card just joins their hand as a normal playable card from here on.
  - **Keep hidden:** don't flip it. They discard any card from hand as their play for this trick. Cosmetic distinction to preserve in the UI/log: if the taker keeps it hidden, their discard is described as face-down; if a non-taker keeps it hidden, their discard is described as face-up. (No functional difference to game logic — just flavor text/log wording.) This choice is available to the taker too, even in the edge case where their active hand holds no trump cards at all — they can still choose to keep it hidden and simply discard normally.
- Once revealed, trump-suit cards gain their power **only for cards played from that point forward in the current trick** — see the precise sequencing rule below. From the *next* trick onward, trump is fully "live": a trump card beats every card of the led suit, full stop.
- Before trump is revealed, trump-suit cards have no special power — they just behave as their normal suit for trick-winning purposes.

**Winning a trick — precise sequencing rule (important, easy to get wrong)**
Track, within each trick, the exact order cards are played and at what point (if any) the reveal happens.
- **If trump was never revealed during this trick:** winner = highest card of the led suit among all four cards played. (This covers the common case where the led suit happens to be the actual trump suit but nobody ever triggered a reveal — those trump-suit cards are just being treated as their ordinary suit here, no bonus power.)
- **If trump was revealed at some point during this trick** (this can only happen on a void player's turn, so it's always the 2nd, 3rd, or 4th card of the trick): winner = highest trump-suit card among the cards played **from the reveal onward** (i.e., the revealing player's own card counts, plus anything played by players after them in this same trick) — cards played *before* the reveal are excluded from winning contention even if they happen to be of the trump suit (this matters specifically when the led suit turns out to secretly be the trump suit: an earlier player who simply followed suit normally, with no idea it was trump, does not get to win off the back of that once it's revealed).
  - If, after applying that filter, there are zero trump cards played after the reveal (e.g. the revealer had no trump and had to fall back to any card, and nobody who played after them held/played trump either): fall back to highest card of the led suit among **all four** cards played in the trick, pre- and post-reveal alike.
- The winner of a trick leads the next trick.

**Scoring — the "double sweep" mechanic (read carefully, this is the trickiest part)**
- There is ONE shared, ever-growing pile of "unclaimed" tricks, starting from trick 1. Nothing is ever discarded from it except by a sweep.
- A **sweep** happens only when the *same individual player* (not just the same team — the literal same seat) wins two tricks **in a row** (i.e., they won the immediately preceding trick too).
- Sweep eligibility only starts from trick 5 onward: a personal back-to-back win where the *second* trick of the pair is trick #4 or earlier never triggers a sweep, even if the same player won tricks 1&2, 2&3, or 3&4. The earliest possible sweep is on trick 5 (as the second half of a 4-then-5 pair). **Exception:** once trump is revealed, this trick-5 floor is lifted immediately — sweeps become possible starting from whatever trick the reveal happens on, even trick 2 or 3.
- The second trick of a would-be pair **cannot be won with an Ace** — if the same player wins back-to-back but the second win is with an Ace, no sweep happens. The pile keeps growing, and — important — their "last trick winner" streak flag stays set to them (they don't need to "start over" with a completely fresh pair; if they win yet another trick right after, that next win can complete the sweep, sweeping the whole accumulated pile including the Ace trick).
- When a sweep does trigger: the winning player's **team** collects the ENTIRE pile as secured tricks (not just the 2 tricks of the pair — every trick that has piled up since the last sweep, or since the start of the round if there's never been one). Add the pile's size to that team's secured-tricks count, then empty the pile and reset the "last trick winner" streak tracker to null (a fresh streak must build from scratch after a sweep — no chaining a 3rd consecutive win onto an already-swept pair).
- If a trick's win doesn't extend a streak (different player won than the immediately preceding trick), it just joins the pile and becomes the new "last trick winner" reference point for the next trick.
- At the end of 13 tricks, any tricks still sitting unswept in the pile count for **nobody** — they're simply lost/wasted, not awarded to either team.

**Winning the round**
- Taker's team wins the round the moment their secured-tricks total is **≥** their bid.
- Opposition wins the round the moment they've secured enough tricks that the taker's team can **no longer mathematically reach their bid**, even if the taker's team won every single remaining trick outright. Since there are 13 tricks total, this threshold is: opposition secured ≥ `14 − bid`. (Worked example: a bid of 11 means the opposition only needs to secure 3 tricks to lock the taker out — `14 − 11 = 3` — because that leaves the taker with at most `13 − 3 = 10` tricks reachable, one short of their claimed 11.)
- **These are live checks, evaluated after every trick resolves — the round can end before all 13 tricks are played** as soon as either threshold is met. See the trick-12 exception below, which overrides this.
- Final/natural resolution, if the round reaches the end of trick 13 without either threshold having fired early: the taker's team wins if their final secured total is ≥ their bid; otherwise the opposition wins. This is the authoritative binary outcome — there is no "nobody wins" result. (Tricks left permanently unswept in the pile simply don't help either side get there; they don't create a third outcome.)

**The trick-12 exception**
- **Confirmed interpretation:** the live win-checks above run after *every* trick, starting from trick 1 — not just from trick 5. In the normal case (trump still hidden), a sweep genuinely can't happen before trick 5 anyway (the sweep-eligibility floor), so the checks have nothing to fire on until trick 5 in practice. But once trump is revealed, that floor lifts immediately (as stated above), so a sweep — and therefore an early round win — can legitimately happen as early as trick 2 or 3 if the reveal and a matching back-to-back both land that early. Mechanics govern here, not a literal "trick 5" prose window.
- The one hard exception, regardless of all of the above: the round may **never** end exactly at trick 12, even if one of the win thresholds is technically met the moment trick 12 resolves — continue to trick 13 in that case only.
- If the round reaches the end of trick 12 without an earlier trick having already ended it, trick 13 must still be played out in full — whoever's turn it is plays their last card, and the trick resolves normally (highest card of the led suit wins, unless a trump card is in play and trump has been revealed by then, using the same trick-winner logic as any other trick — note trick 13 can still complete a sweep with trick 12 if the same player wins both). Only after trick 13 resolves does the round's outcome get read off the final tally.

---

## Worked examples (use these as test fixtures / unit tests)

1. Tricks 1–3 won by different players each time (no sweep possible pre-trick-5 anyway) → pile grows to 3, nothing secured yet.
2. Trick 4: player A1 wins. Trick 5: player B1 wins (different player than trick 4 → no sweep, but B1 is now the streak reference). Trick 6: B1 wins again (same player, consecutive, trick 6 ≥ 5, not an Ace) → SWEEP. Team B secures tricks 1 through 6 = 6 tricks total. Pile resets to empty, streak resets to null.
3. Trick 7: A2 wins → pile:[7], streak=A2. Trick 8: A2 wins again with an Ace → same player back-to-back, but Ace blocks the sweep → pile:[7,8], streak stays A2 (not reset). Trick 9: A2 wins again (non-Ace) → same player as streak (A2), consecutive, not an Ace → SWEEP → Team A secures tricks 7,8,9 = 3 tricks.
4. Trump gets revealed during trick 3 (someone void chose to flip it). From trick 3 onward, the trick-5 sweep floor no longer applies — a sweep could legitimately occur as early as trick 3-then-4 if the same player wins both.
5. **Trick-12 exception:** taker's bid is 8. By the end of trick 11, taker's team has already secured 8 tricks (bid reached) — under the plain live-check rule this would end the round right there, and it's allowed to (trick 11 isn't the forbidden trick 12). Contrast: if that same threshold-crossing sweep instead completes exactly on trick 12, the round does *not* end there — trick 13 must still be played out, and only then is the win recorded (it will still be a win for the taker's team, just confirmed one trick later than the threshold was technically met).
6. **Opposition nullification:** taker's bid is 11. Opposition secures tricks such that their running secured total hits 3 on trick 9 (`14 − 11 = 3`) — since the taker's team can now never reach 13 − 3 = 10 < 11, the round ends immediately with an opposition win, *unless* that 3rd secured trick happens to land exactly on trick 12, in which case wait for trick 13 per the exception above before declaring it.
7. **Led-suit-is-trump sequencing:** led suit is Hearts, and Hearts is secretly the trump suit. P1 leads a Heart (pre-reveal, no power yet). P2 follows with a higher Heart. P3 holds no Hearts — void — and chooses to reveal: Hearts is now known as trump. P3 does not hold a Heart to play, so (per the taker/non-taker rules above) falls back to any card. P4, also void in the original led suit but now aware trump is Hearts since it was already revealed, happens to hold a Heart and plays it. Winner = the highest Heart among cards played **after the reveal** only — here, that's just P4's Heart, since P3's fallback card wasn't a Heart. P1 and P2's Hearts, played before the reveal, are excluded from contention even though they're the trump suit, despite being objectively higher cards. If P4 also held no Heart and had to fall back too, the winner would default to the highest Heart among all four original plays (P1 or P2's).
8. **Taker's returned trump card:** the taker (12 active cards) is void in the led suit on trick 6 and chooses to reveal. Their hidden trump card flips over and rejoins their hand. If the taker's active hand also happens to hold another card of that suit, they may play either that card or the newly-returned one to satisfy the "must play trump" obligation — their choice. If they play something other than the returned card, the returned card stays in their hand as a normal playable card for future tricks.
9. **Ascending bidding with a 13 short-circuit:** P1 bids 6. P2 bids 4 — not higher than 6, so P1 remains the leading bidder (P2's 4 is just recorded, doesn't take the lead). P3 bids 9 — higher than 6, so P3 is now leading. P4 bids 13 — the bidding stops immediately; P4 is the taker, regardless of the fact that not everyone technically finished a "normal" turn cycle. Contrast: if instead P4 had bid 10, bidding would end there anyway (all 4 have now bid) and P3 (9) would lose to P4 (10) — P4 is the taker.

Write these (or equivalent) as explicit unit tests against the trick-resolution/sweep function in isolation from the UI/networking layer — this logic is the part most likely to have off-by-one bugs (especially the trick-5 floor and the "streak survives an Ace block" rule).

---

## Networking / room flow

1. Landing screen: enter a display name and a room code (create if it doesn't exist, join if it does).
2. Lobby: 4 seats (P1–P4), each shows Team A/B. Players claim an open seat. Once all 4 are filled, any seated player can start the round.
3. Server deals the first 5 cards, then runs the ascending bidding auction in turn order (server enforces turn order, the 1–13 range, the "must beat current high bid to take the lead" rule, and the 13-bid short-circuit). Once a taker is set, they privately select their trump card (server withholds its identity from everyone else), and the server deals out the rest of the deck starting from the taker's seat around the table.
4. Playing phase: server enforces turn order, follow-suit legality, the leading-suit-repeat restriction, the void/reveal choice, and the trump-play obligation after a reveal. Reject illegal moves server-side with a clear error, don't just rely on the client disabling illegal cards (client-side disabling is a UX nicety, not the source of truth).
5. Round end: this can be triggered either by the natural end of trick 13, or by an early win threshold firing on trick 5–11 (see the win-condition and trick-12-exception rules above — implement this as a live check the server runs after every trick resolves, not just a check at trick 13). Show the final breakdown (bid, each team's secured count, what happened to the unswept pile if any, and which trick number the round actually ended on) and let any seated player trigger the next round (dealer rotates one seat).
6. Handle disconnects/reconnects reasonably: if a player refreshes or drops, let them rejoin the same room+seat by re-entering the same room code and name, and have the server resume sending them their hand and the current state rather than losing their seat immediately.

## Non-goals for v1
- No spectator mode, no persistent accounts/login, no cross-round leaderboard persistence beyond the current server process, no animations beyond simple card-flip/deal transitions if you have time.

## Deliverable
A working local dev setup (`/server` and `/client` or similar), a short README with rules summary and how to run it, and the unit tests described above for the scoring engine. Flag in your own words any rule interpretation you had to make a judgment call on, so it can be reviewed against the examples above.