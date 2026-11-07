# ntfy topics

Every machine alert, notice and report reaches the owner through the self-hosted,
tailnet-only ntfy server (`config/ntfy/server.yml`). Slack is retired as a sender
(Issue 173 for this repo, Issue 249 for the rest). One token (`op://common/ntfy/TOKEN`) publishes to every
topic: `POST <base-url>/<topic>`, body is the text, header `Authorization: Bearer <token>`,
optional `Title`, `Priority`, `Tags`. The base URL is `base-url` in `config/ntfy/server.yml`.

Topics are named by who reads them and how fast. The set is small on purpose: a new
topic needs a reader who would act differently on it. `config/ntfy/topics.txt` is the list;
`tests/test_ntfy_topics.sh` fails when it and this table differ.

## Topics

| Topic | Reader's question | Priority | Publishers |
|-|-|-|-|
| `alerts` | Is something broken that I should look at? | 5 down, 4 up/warn, 3 digest | Uptime Kuma (provider `ntfy - Alerts`, 5 on DOWN / 4 on UP), HyperDX alerts and background-job failures, the homelab watchdog (4 when a line carries 🚨, else 3), Beszel (shoutrrr URL set in the Beszel UI). To move: homelab-private scripts (`lib.sh` `notify`, `vpn-watchdog.sh`, `vpn-cycle.sh`) and torrent-app system alerts, WeatherOrb warden |
| `watchdog` | Did a scheduled audit find drift, with nothing down? | 2-3, never above 3 | Audits and self-heal digests: Hermes brain drift audit and other agent audits, restore-check results. Nothing in this repo publishes here yet; the homelab watchdog's own findings stay on `alerts` |
| `updates` | What changed on my machines? | 3, none for routine | Watchtower (`updates?title=Watchtower`), RollHook deploys, finished long jobs (podcast episode) |
| `media` | Is something ready to watch, or a tracker obligation due? | 3, 4 for a seed obligation at risk | homelab-private torrent-app (downloads ready, library events, seed obligations); the arr and Jellyfin stack has no notifier of its own |
| `briefings` | What is the digest of my agents and projects? | 2-3 | Hermes scheduled reports (project narratives, usage weekly, morning briefing, evening report when un-paused), the agents overview |
| `factory` | Does the software factory need me? | 3 notice, 4-5 ask | The software factory (asks, notices, Kuma door) |
| `home` | Something at home worth a nudge | 3 | Home automations (morning greeting, window-open hint) |
| `models` | A new big model is out | 3 | modelpick (after its 06:00 refresh) |

Priority 4 and 5 are for what needs the owner now; the Mac client keeps those until dismissed.

## Subscribe list

The same eight names on both clients, no wildcard, on the one ntfy server:

```
alerts  watchdog  updates  media  briefings  factory  home  models
```

- **Mac (ntfy-mac):** subscribed by config. `make ntfy-subscribe` subscribes the owner's
  ntfy account server-side; ntfy-mac reads `/v1/account` every 30 minutes and picks
  the topics up with no step on the Mac.
- **iPhone (ntfy app):** the iOS app has no account sync, so each name is added once by
  hand: *Subscribe to topic*, pick the self-hosted server, enter the name. Queue item:
  `make human-queue` in the dotfiles repo lists it.

`make ntfy-subscribe` is idempotent and safe to repeat; `scripts/ntfy-subscribe.sh --test`
also publishes one priority-2 message per topic, which is how a new topic is proven.

## Adding a topic

1. Add the name to `config/ntfy/topics.txt` and a row above.
2. `make test`, deploy, `make ntfy-subscribe`.
3. Add it on the iPhone.
