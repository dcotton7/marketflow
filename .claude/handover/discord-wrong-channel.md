# Discord wrong channel (branch anima/discord-wrong-channel)

Why: 10 Nov, Discord sat on #trading-floor ~13h; health only said `no_new_messages_20m`.

## Changed
- `discord-watch.ps1`: heartbeat adds `running` (Discord process exists), `minimized` (user32 IsIconic, read-only), `channelName` (title channel, raw). `window:false` with `running:true` = closed to tray.
- `discord-health.ts`: new problems `wrong_channel_open`, `discord_minimized`, `discord_not_running` (market hours only). When one is present, `no_new_messages_20m` is NOT added (it only appears when the right channel is open). New fields `messages[]` (plain text, parallel to `problems`) and `discord{running,minimized,channel,server}`. Names are stripped with the watcher's rule (letters, digits, - _), lower case. Stale relay heartbeat -> no cause reported. Older watchers (no new fields) behave as before.
- `DiscordRoomIdeas.tsx` (so `/embed/discord-ideas` too): amber banner from `/api/health/discord` every 30 s.
- Tests: `npx tsx server/bridge/discord-health.test.ts` (trading-floor, quiet live-stream-chat, minimized, no window, not running, emoji strip, after hours, old watcher). Relay and twin tests pass. tsc filtered to touched files: no errors.

## Not done (outside MarketFlow) - admin
`H:\AI LLM\ops\marketflow_keepalive.ps1` sends the phone alert and writes only the problem keys (`$p -join ', '`, ~line 133, and the problem set around 104-111). To use the same text: where it builds the alert from `$h.problems`, append `$h.messages` (join with '; ') when present. The new keys also need no other change. Its `-SelfTest` JSON has no `messages`, so keep it optional.
## Gotchas
- The watcher must be restarted (bridge restart) to send the new heartbeat fields; until then health behaves as before.
- Not tried against a live minimized Discord; IsIconic and title parsing checked on this PC (title `#📈︱trading-floor | Market Pulse - Discord`, parses clean).
