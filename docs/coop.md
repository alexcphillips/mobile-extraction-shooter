# Co-op to-do

Co-op against AI with a friend: two (later up to four) players in one raid. No PvP, matchmaking with strangers or anti-cheat for now (CLAUDE.md).

**Phones and PCs alike** (the user's requirement, 2026-10-31): the game is the same web page on both, so a party can be any mix of iPhones and PC browsers (Chrome, Edge, Firefox, Safari). Everything below must work on both; where they differ, it says so.

**How a co-op raid runs (the user's call, 2026-10-31): one player's device hosts.** The host's browser runs the shared simulation for everyone, as it already does for a solo raid, and the others connect to it **directly over WebRTC data channels**. Cloudflare only introduces the devices to each other (signalling through the Worker) and relays the traffic when a direct connection can't be made (Cloudflare Realtime TURN). This replaces the earlier plan of one Durable Object per raid, because the free plan's 100,000 requests a day counts every message a phone sends to a Durable Object: a few raids a day at most (see the Cloudflare check below). Hosted on a device, co-op is free with no daily cap that matters.

## How to use this file
Like roadmap.md: each item is sized for one Claude Code session ("Do co-op session C3 from docs/coop.md"). Tick it off, add short notes, and record decisions in design.md or tech-stack.md.

The roadmap puts co-op after v1 (sessions 19b–20 are still open). Starting this list before v1 is the user's call to make; nothing here blocks the solo game.

## Cloudflare check (2026-10-30)
Checked before building anything, at the user's request: can Cloudflare run a co-op raid, and on the free plan? From Cloudflare's docs (limits and pricing pages, read 2026-10-30) and a local benchmark of the shared sim run as a server would (2 players, real enemy AI, M1 Mac, Node 22).

**Measured on the Mac:**

| Raid | Nav grid build | Tick, roaming (mean / p99 / max) | Tick, everyone fighting (mean / p99 / max) | CPU per raid second, fighting | Full state as JSON |
|---|---|---|---|---|---|
| mall, 11 enemies | 160–175 ms | 0.06 / 0.3 / 5 ms | 0.47 / 5.8 / 6.4 ms | 14 ms | 52 kB |
| mall, 30 enemies | 157 ms | 0.12 / 0.6 / 3.2 ms | 1.0 / 6.4 / 7.8 ms | 31 ms | 101 kB |
| test map, 3 enemies | 48 ms | 0.01 ms | 0.01 ms | 0.3 ms | 14 kB |

The whole benchmark's heap stayed under 50 MB, including all the content.

**What a Durable Object raid server would have cost on the free plan:**
- Memory (128 MB) and duration (115 GB-s per 15-minute raid against 13,000 a day, so about 110 raids) were fine.
- **Requests weren't:** 100,000 a day, counting every incoming WebSocket message. The 20:1 discount on those may not apply to the free cap (the docs don't say). At 10 input messages a second from 2 players, about 5 raids a day.
- **CPU was unclear:** 30 s per invocation on the Durable Objects limits page, but 10 ms (the Workers free limit) according to its FAQ. At 10 ms, the nav grid build and a fight's worst ticks wouldn't fit.
- Workers Paid ($5 a month) would have fixed both. The user chose free, hosted on a device, instead (2026-10-31).

**What still applies with a device hosting:**
- The sim is cheap: an average fighting tick is a few percent of the 33 ms tick on the Mac, so a phone can host 2 players (it already runs every enemy in a solo raid; hosting adds networking, not rendering).
- Never send the full state per tick (52–101 kB). Snapshots are deltas of what changed, aiming at a few kB at 10–20 Hz: about 40 MB per 15-minute raid, which matters for phone data and relay usage.

**The free services this uses:**
- **Signalling:** a handful of Worker requests per raid (offer, answer, polling the party) against the 100,000 a day.
- **STUN:** `stun.cloudflare.com`, free and unlimited. Finds each device's public address; enough for a direct connection on most home Wi-Fi.
- **TURN:** Cloudflare Realtime TURN relays when a direct connection fails (common on 4G/5G, behind carrier NAT): 1,000 GB a month free, then $0.05 per GB. At about 40 MB a raid, about 25,000 relayed raids a month. Credentials are short-lived, made by the Worker with an API token kept as a secret. **Check in C4 whether it needs a card on the account.**

## Phase 1: friends and the party
Social pieces first, so two accounts can find each other and agree to play together. All plain Worker + D1 routes.

- [x] **C1. Friends list.**
  - D1 migration: `friends` (`account`, `friend`, `status`: `pending` | `accepted`, `created_at`), one row per direction or one per pair (decide in the session; one per pair with a CHECK on order is tidier).
  - Routes (shared `protocol.ts` types, `signedIn`): `GET /api/friends` (accepted, incoming, outgoing), `POST /api/friends/requests` (`username`, case-insensitive, as accounts are), `POST /api/friends/requests/:id/accept` and `/decline`, `DELETE /api/friends/:id`.
  - Limits: at most 100 friends and 20 pending outgoing requests; asking someone who already asked you accepts theirs; no request to yourself. Errors are `ApiErrorCode`s.
  - Main menu: a **Friends** screen (lazily loaded like the vendors page): your list, incoming requests with accept/decline, an add-by-username field. Works by touch and by mouse and keyboard.
  - Server tests against the D1 stand-in.
  - *Done when* two accounts, on a phone and a PC, can add each other and both see the other in their list.
- [x] **C2. Presence.**
  - Whether a friend is **online** (seen in the last 60 s), **in the menu**, **in a raid**, or **in a party**, and whether they're on a **phone or PC** (it helps pick the host, C4).
  - The menu sends a heartbeat (`POST /api/presence`) every 30 s while it's showing, stored as `accounts.seen_at` and `activity`; `GET /api/friends` returns them. Polling only while the menu is open keeps it well inside 100,000 requests a day.
  - *Done when* the friends screen shows who's online and what they're doing, correct within a minute.
- [x] **C3. Party and invites.**
  - A **party** is up to 4 accounts with a leader: D1 `parties` (`id`, `leader`, `created_at`) and `party_members` (`party`, `account`, `ready`, `device`: phone or PC). You're in at most one party; on your own you're a party of one, implicitly.
  - Routes: `POST /api/party/invites` (`friend`), `GET /api/party` (members, ready flags, invites to you), `POST /api/party/invites/:id/accept` and `/decline`, `POST /api/party/leave`, `POST /api/party/kick` (leader), `POST /api/party/ready`. An invite expires after 5 minutes. Only friends can be invited.
  - **Invite link too:** the leader can share a link (`/join/<code>`) that joins the party after sign-in. On a phone it opens the share sheet (`navigator.share`); on a PC, where that's often missing, a **copy link** button. With one friend this is the quickest way in, and it doesn't need them to be on the menu.
  - Main menu: a party strip (members, ready ticks, invite button), and an invite banner while the menu is open (picked up by the presence poll from C2; no push notifications).
  - The leader picks the raid; **Start** is enabled when everyone's ready. Until C5 lands, Start in a party of more than one says co-op isn't ready yet.
  - *Done when* you can invite a friend from the friends list or by link, they accept on their phone or PC, both see the same party, and both ready up.

- **Notes on C1–C3 (2026-10-31):**
  - Built together: migration `0003_social.sql` (`friends`, one row per pair with a unique index on the pair either way round, `accepted_at` null while it's a request; `parties`, `party_members`, `party_invites`; `accounts.seen_at` and `device`), `server/src/social.ts` (all the routes), the types and `SOCIAL` limits in shared `protocol.ts`, and on the client `social.ts`, `ui/friends-page.tsx` and `ui/party-strip.tsx` on the main menu. 11 server tests.
  - **Presence is one heartbeat:** `POST /api/presence` every 10 s while the menu shows (`PartyWatch`), and again when the page comes back into view. It replies with the party and invites, so invites show within about 10 s. About 360 requests an hour per player on the menu; nothing during a raid. "In a raid" comes from an open raid row started in the last 20 minutes, not a heartbeat.
  - **Phone or PC** is `(hover: hover) and (pointer: fine)` at the time of the heartbeat (`deviceKind`), so a touchscreen laptop with a mouse counts as a PC.
  - **The invite link** joins anyone who has it, friend or not (that's what makes it quicker than adding a friend). A party is made on the first invite or the first Invite link press; on your own you're in no party. The leader leaving passes the lead to the next to have joined; the last to leave breaks it up. The leader's raid pick is the party's; changing it clears everyone's ready.
  - **The client knows the player's username, not their account id,** so the menu finds you among the members by username (unique ignoring case).
  - In a party of more than one, **Start raid is disabled** ("co-op raids are coming soon") until C5.
  - Not done: no push for invites (by design); the friends page doesn't refresh the party strip's view of who's in your party until the next heartbeat.

## Phase 2: the hosted raid
- [ ] **C4. Spike: connecting two devices.** Settles what can't be known from docs.
  - Signalling through the party: the host posts a WebRTC offer, the guest picks it up from `GET /api/party` and posts an answer. Gather all ICE candidates before sending (no trickle), so it's one offer and one answer per guest, a few requests in all.
  - STUN `stun.cloudflare.com`; TURN from Cloudflare Realtime, credentials from a Worker route (`POST /api/party/turn`), the API token a Worker secret.
  - One data channel to start, reliable and ordered (simplest; inventory actions can't be lost). Try an unreliable one for movement only if measured lag needs it.
  - Test every pair that matters: iPhone ↔ iPhone (one on 4G), iPhone ↔ PC, PC ↔ PC. Measure: connects or not, direct or relayed, round-trip time, throughput for 10–20 Hz snapshots.
  - **Find out what happens when the host goes away:** an iPhone locked or switched to another app stops the page's JavaScript; a PC tab in the background has its timers slowed to about once a second. Try running the host's sim in a Web Worker (on a PC, its timers may not be throttled; on iOS it stops too).
  - *Done when* the numbers and the background behaviour are in this file and tech-stack.md, and the host rule (below, C5) is confirmed.
- **Notes on C4 (2026-10-31): built; the device results are still to come.**
  - Server: migration `0004_signals.sql` (`party_signals`, one offer and one answer per pair, replaced by a newer one); `POST /api/party/signal`, `GET /api/party/signals` (hands them over and deletes them), `POST /api/party/ice` (STUN, plus TURN credentials made with the Worker secrets `TURN_KEY_ID` and `TURN_KEY_TOKEN` when they're set, 4-hour TTL, port 53 URLs left out). `PartyResponse.signals` counts the signals waiting, so the menu's heartbeat notices a call.
  - Client: `net/peer.ts` (`PeerLink`: one reliable, ordered data channel; no trickle, waiting up to 5 s for ICE gathering; `path()` reads direct or relayed from the stats, with a fallback for Safari's missing transport stats), `net/conn-test.ts` and `ui/conn-test-panel.tsx`. **Test connection** on the party strip calls every other online member; their menu picks the call up on its next heartbeat (up to 10 s) and answers by itself. The panel shows connect time, ping, snapshots sent and received (3 kB at 20 Hz for 10 s, about 60 kB/s, skipping when the channel's buffer backs up), direct or relayed, and a timed log that includes the page being hidden and shown. **Copy** puts it all on the clipboard for these notes.
  - Shared `pickHost(party)` (`coop/host.ts`): a PC first, then the leader, then whoever's online. The panel shows who would host.
  - **Checked on the Mac (two headless Chrome sessions, localhost, STUN only):** the invite link joined the party; the test connected **direct** in about 2 s from pressing the button (0.5 s from the offer arriving), ping 1–4 ms, 199 of 199 snapshots received at 25.6 kB/s.
  - **TURN key added (2026-11-01):** in `packages/server/.dev.vars` for the dev server (git-ignored); the live Worker needs `wrangler secret put TURN_KEY_ID` and `TURN_KEY_TOKEN`. **Checked through the relay** (the two Chrome sessions with direct routes turned off in the test): connected **relayed** in 2.2 s, ping 22–98 ms, 199 of 199 snapshots. Gathering every TURN address took the whole 5 s, so a description is now sent 1 s after the first relay candidate (`AFTER_RELAY_MS`): the offer went out at 1.5 s instead of 5.5 s.
  - **Still to do on devices:** iPhone ↔ PC on Wi-Fi, iPhone on 4G ↔ PC (likely to need the relay), iPhone ↔ iPhone, and locking the phone mid-test. Paste each panel's Copy output here.

- [ ] **C5. Joining a raid together.**
  - **Who hosts:** a PC if there is one in the party (mains power, a faster CPU, and a background tab only slows down rather than stopping), else the leader. Shown in the party strip before Start.
  - Starting: the leader's `POST /api/raids` names the party; the server opens a raid row for **each** member (each still has at most one open raid) and replies with each member's gear. Each guest sends its gear to the host over the channel, and the host spawns everyone together at one player spawn (design.md → Map). Quest items only for their holder (already in `startQuests`).
  - Both devices must run the **same build**: the handshake compares the build and content versions and refuses with "update the game" if they differ.
  - Protocol (in shared, versioned): guest → host, its `PlayerInput`s batched every 2–3 ticks; host → guest, deltas of the parts of `SimState` that changed, plus `events`. JSON first; binary only if measured to need it.
  - Each client draws the other players as it draws enemies (the character rig), with the controls of its own device (touch or mouse and keyboard; aim assist is per device, as now).
  - *Done when* a phone and a PC see each other move around the same map with enemies, without prediction (laggy is fine).
- **Notes on C5 (2026-10-31): built and working in two browsers on the Mac; not yet seen on a phone.**
  - **Starting:** `POST /api/party/start` (leader only; everyone else online and ready; a raid picked) sets `parties.started_at`, `session` and `host` (`pickHost`, migration `0005_party_start.sql`) and clears ready. `Party.start` shows it for 60 s. Each member's menu sees it (in its heartbeat, or the leader's reply), flushes the stash and goes in with `MenuChoice.coop`; `main.ts` starts the member's own server raid as for a solo one, so each player's gear and result are their own. A tab remembers the sessions it joined, so the menu doesn't rejoin one.
  - **The raid button** (2026-11-01): on the menu and in the stash it's one button. Alone or leading, it starts the raid (the leader's waits until everyone's ready); in someone else's party it's **Ready? / Ready ✓** instead, and the party strip no longer has its own ready button.
  - **Connecting** (`net/coop-link.ts`): the host calls each guest with the session as the signal's session; both poll signals every second for up to 60 s (the host can be a heartbeat behind). The menu doesn't pick up signals once a start is showing, so it can't take the raid's calls for the connection test. `PeerLink.listen` holds messages that come before anyone listens.
  - **The raid** (`play/coop.ts`): the host builds the raid as for solo, connects, waits up to 15 s for each guest's `join` (name and the gear from its server raid), spawns each beside the host (0.9 m either side, in turn), and sends a `welcome`: the whole state, the guest's entity, the spawn, the enemy spawns' entities and every player's name. The guest starts from it as from a saved raid (the resume path). Each tick the host merges each guest's inputs (`mergeInputs`: the latest stick and look, any press, every inventory action), steps, and sends `{ p, e }`: the patch from shared `net/sync.ts` and the tick's events. A guest sends its input and applies whatever ticks came (`catchUp`), instead of stepping.
  - **Sync** (shared `net/sync.ts`): `diff`/`apply`/`strip`, in place, matching lists of things with ids by id, so every object the client holds stays the same object. Left out: `rng`, `events` (sent alongside) and `ai`. **Measured on the mall** (11 enemies, 2 players, everyone fighting): a patch is 0.9 kB a tick on average (2 kB at p99), about 26 kB/s at 30 Hz; the first full state is 37 kB; diff and apply take 0.15 ms a tick.
  - Other players are drawn with the default outfit (`others` in `play/index.ts`), hidden once out of the raid. **Auto-fire and aim assist never target another player.** A guest's debug hurt/heal, admin spawner requests and `?respawn` do nothing; its giving up is sent to the host. No raid snapshot is saved in a party raid. A guest that loses the host ends as missing in action ("Lost the connection to the host"); C7 will do better. A host that's out (extracted or dead) keeps the raid running under its results screen until every guest is out.
  - **Checked (two headless Chrome sessions, localhost):** Start party raid took both into the mall at the same spawn, side by side; the guest walked and its position came back from the host; the host saw the guest's body walking.
  - **Not done yet:** shots and kills by a guest aren't credited on the guest's results (kills come from events, which should work, but not checked with a gun); quests for guests (only the host's markers and quest items); enemies from an admin spawner gun aren't drawn on guests; a guest joining late or reconnecting (C7); bandwidth on 4G and the relay (C4's device tests).
  - **Searched containers (2026-11-03):** `LootContainer.searched` lives in `SimState.loot`, so the host's deltas already carry it (containers are matched by id) and it must stay out of `OMIT`. A guest's `PlayerInput.search` is a press, merged in `mergeInputs` like `door`. Tested solo and in `mergeInputs`; not yet seen in a real two-player raid.

- [ ] **C6. Prediction and interpolation.**
  - The host has no lag. A guest runs its own movement ahead and reconciles with the host's position (replaying inputs since the acknowledged tick); the other players and enemies are interpolated between snapshots.
  - Shooting: the host decides hits. Decide in the session whether a guest's own tracers and hit markers show at once (predicted) or on the host's word.
  - *Done when* a guest's movement feels as good as solo, on a phone over 4G and on a PC.
- [ ] **C7. Ending the raid, and the host going away.**
  - Each player extracts, dies or runs out of time on their own; `state.left` already records each. The host sends each guest its result, and **each device posts its own result** to the server, as a solo raid does (`/end`, with the same checks). The client is trusted (design.md → Server), so the host's word is enough.
  - A dead player watches the others (spectate) or goes back to the menu; decide in the session.
  - **A guest drops:** its character stays in the raid, standing still, for 60 s to reconnect, then counts as missing in action.
  - **The host goes away** (a phone locked or switched away, a tab closed, a connection lost): the raid can't run without the host's device. Proposed: the raid **pauses for everyone** for up to 60 s with a notice, resumes when the host is back, and otherwise ends; or the host's state (plain JSON, as the raid snapshot already saves it) is **handed to a guest**, who becomes the host. Hand-over is more work but keeps the raid; decide in the session, informed by C4.
  - The solo pause rules (tech-stack.md → Pausing) don't apply to a guest: its menu and a hidden page don't stop the raid. The solo raid snapshot is replaced by the hand-over above.
  - *Done when* a full raid ends correctly for everyone, including a guest dropping and coming back, and the host's phone being locked.

## Phase 3: playing it properly
- [ ] **C8. Co-op details.**
  - The sim's loot checks also require line of sight (pass the world into `canReach` and `gridOf`; the client-side check was added 2026-10-30, the sim's is still distance only). With a guest's actions applied by the host's sim, this now matters.
  - Two players looting one container or body at once: actions already name the item the sender saw, so a stale one fails; show it in the UI.
  - Item instance ids if co-op looting needs them (tech-stack.md → Inventory).
  - Admin cheats and spawner guns: honoured only for the host in dev builds, or off in co-op.
  - **No party HUD** (the user's call, 2026-11-01): no name tags over teammates, no teammate health on the HUD, no markers for them on the map tab. (Spectating after death shows the watched teammate's own HUD: see below.) Like Tarkov, you tell friend from enemy by looking, and talking.
  - [x] **Spectating after death** (2026-11-01, the user's ask). Killed in a party raid, after the usual 1.5 s you watch through a teammate's eyes who's still in it, with their gun, recoil, flashes and fire, and their hearing. ◀ ▶ switch between teammates; Results stops. When the last one dies or leaves, the results come up by themselves. It works the same for the host and a guest: a dead host's device keeps running the raid. Your result is saved at death, as before, so spectating changes nothing on the server. In `play/index.ts` (`watch`, `follow`) and `hud/spectate.ts`.
    - Only first-person, never a free camera, so a dead player sees no more than the living one already can (less "ghosting" over a voice call). The spectate bar names who you're watching; that's for the dead player, not a tag in the world.
    - Fixed alongside: `CoopHost.playing` counted a dead guest as still playing (bodies stay in `sim.entities`), so a host could keep running the raid for nobody. A guest now closes its link when its results come up.
    - Checked in two headless Chrome players, host dying first and guest dying first. Not yet on devices.
    - **Their HUD while you watch (the user's call, 2026-11-06):** the limb figure and armour (`#vitals`), rounds and ammo type (`#ammo`), the red flash when they're hit, and their hand slots are the teammate's, not yours. `play/index.ts` hands `watching ?? player` to `Vitals.update` and `HandsHud.update`. The hand slots are shown but can't be pressed. Every other control stays hidden, and the spectate bar moves to the bottom right, out of the hand slots' way. This is only for a dead player watching; there's still no party HUD while you're alive (below). Layout checked in headless Chrome with the spectating class switched on in a solo raid; not yet with two players.
- [ ] **C9. Play-test and costs.**
  - A full raid with a friend, phone and PC, then two phones with one on 4G. Afterwards check the Worker's requests and the TURN usage in the Cloudflare dashboard.

## Decided
- **Friendly fire is on** (the user's call, 2026-11-01): players' shots, knives and grenades hurt each other, as in Tarkov. Auto-fire and aim assist still never target a teammate. **Enemies never hurt each other** (the user's call, 2026-11-06): see design.md.
- **No name tags or teammate markers** (the user's call, 2026-11-01): nothing on screen says who's a friend. See C8.

## Open questions
- **Voice or text chat?** Not planned. A friend on a call is probably enough; a few quick pings ("here", "loot", "enemy") might be worth more than chat. Text chat is easy on a PC and awkward on a phone.
- **Party size:** 2 to start, 4 as the cap? More players means more AI to keep a raid hard, and more work for the host's device.
- **Push notifications** for invites (web push needs the home-screen install and permission on iOS). Left out; the invite link covers someone who isn't on the menu.
