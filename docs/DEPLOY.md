# Deploy to Railway

OpenMuse runs as three Railway services built from this repository: the API (with its task worker), the static web client, and the agent browser. The Linux computer is not covered here.

A reachable deployment must use the live workspace. The sample workspace has no sign-in and refuses a non-loopback `HOST`.

## API service

- Dockerfile path `infra/api.Dockerfile`, health check path `/api/health`, domain target port `8787`.
- Storage, either:
  - **Postgres and a bucket (recommended).** Add a Postgres database and a Storage Bucket to the project and set `DATABASE_URL` and the `S3_*` variables below. No volume: updates overlap, so a deploy never drops a reply in progress (see [Moving off the volume](#moving-off-the-volume)).
  - **A volume at `/data`.** It holds PGlite, documents and the server keys. Run a single replica: PGlite cannot be shared between processes, and each deploy briefly stops the API.
- Generate a Railway domain before setting the variables below.

| Variable | Value |
| --- | --- |
| `WORKSPACE_MODE` | `live` |
| `AGENT_BACKEND` | `model` |
| `MODEL` | For example `anthropic/claude-sonnet-5` |
| `ANTHROPIC_API_KEY` | Provider key matching `MODEL` (or `OPENAI_API_KEY` / `GOOGLE_API_KEY`) |
| `WORKER_MODEL` | Optional. Model for background work (delegated tasks, routines, subscription scans), for example `anthropic/claude-haiku-4-5` to cut costs while chat keeps `MODEL`. Defaults to `MODEL`; its provider key must be set too |
| `MODEL_PRICES` | Optional. Adds or corrects the list prices used for cost estimates in Apps → Usage, in dollars per million input/output tokens: `claude-opus-5=5/25,gpt-5.6-terra=2/12` |
| `WEB_SEARCH_MODEL` | Optional. With `ANTHROPIC_API_KEY` set, agents search the web through Anthropic's web search tool using this model (default `claude-haiku-4-5-20251001`) |
| `CODE_MODEL` | Optional. With `ANTHROPIC_API_KEY` set, Neddy gets a private code sandbox (Anthropic's code execution tool: Python and shell, no internet) for numbers, spreadsheets, charts and file conversions; files it makes are saved to Files. This model runs it (default `claude-sonnet-5`). About 1,550 free sandbox hours a month per organization, then $0.05 an hour; model tokens are billed as usual |
| `VISION_MODEL` | Optional. Model that looks at pictures in Files; defaults to the Anthropic model in `MODEL` |
| `AVATAR_MODEL` | Optional. Model that draws avatars from a description; defaults to the Anthropic model in `MODEL` |
| `OPENAI_VOICE_API_KEY` | Optional. Turns on live talk (the headset in the chat): real-time voice with OpenAI's `gpt-live-1`, for the admin for now. Kept on the server; the browser never sees it. After adding it, choose Deploy. The API's deploy log then says `Live voice on`, or `Live voice off: …` when it's missing |
| `VOICE_LIVE_MODEL` / `VOICE_LIVE_VOICE` | Optional. Live talk's model (default `gpt-live-1`) and voice (default `marin`) |
| `VOICE_IDLE_SECONDS` | Optional. Live talk hangs up after this many seconds with nothing said either way (default `90`) |
| `VOICE_PRICES` | Optional. Per-minute prices for Usage, in dollars: `gpt-live-1=0.05` |
| `CPK_INTELLIGENCE_API_KEY` | Server-only key from `npx copilotkit@latest project select` |
| `OPENMUSE_ACCESS_KEY` | Random secret of at least 24 characters, used to sign in |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `PUBLIC_API_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `ALLOWED_ORIGINS` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `COMPOSIO_API_KEY` | Optional. Connects Outlook, Slack, Notion and 1,000+ more apps through Composio |
| `COMPOSIO_AUTH_CONFIGS` | Optional. Auth configs to use for apps Composio can't sign in to itself, such as `brex=ac_…` (comma-separated). Found automatically when unset |
| `COMPOSIO_WEBHOOK_SECRET` | Optional. New-email alerts and "when X emails me, do Y" rules work without it: a live server registers its own webhook with Composio at `PUBLIC_API_URL/api/webhooks/composio` when it starts, and keeps the signing secret encrypted in its database. Set this only to use a webhook you created in the Composio dashboard yourself |
| `BROWSER_WORKER_URL` | `http://${{browser.RAILWAY_PRIVATE_DOMAIN}}:8790` |
| `WORKER_TOKEN` | Same random 32+ character secret as the browser service |
| `RESEND_API_KEY` | Optional. Reads email sent to the agent's address |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the Resend `email.received` webhook pointing at `PUBLIC_API_URL` + `/api/inbound/resend` |
| `AGENT_EMAIL` | The agent's address, e.g. `muse@<id>.resend.app` or an address on a receiving domain |
| `AGENT_EMAIL_ALLOWED_SENDERS` | Comma-separated senders who may hand the agent work; editable later in Apps |
| `ADMIN_EMAIL` | Your email. Turns on email sign-in links and lets you invite people; needs `RESEND_API_KEY` |
| `AUTH_EMAIL_FROM` | Optional sender of sign-in emails; defaults to `OpenMuse <signin@` + the `AGENT_EMAIL` domain + `>`, which must be verified for sending in Resend |
| `EXTRA_ALLOWED_ORIGINS` | Optional extra web addresses allowed to use the API, comma-separated. Adding a custom domain to the web service changes what `${{web.RAILWAY_PUBLIC_DOMAIN}}` gives `ALLOWED_ORIGINS`, so list both the custom domain and the `*.up.railway.app` address here (for example `https://muse.neatoventures.com,https://web-production-16243.up.railway.app`) |
| `APP_URL` | Optional web address used in sign-in links; defaults to the first `ALLOWED_ORIGINS` entry |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` to keep records in Postgres instead of PGlite on the volume |
| `S3_BUCKET` | `${{<bucket>.BUCKET}}`: the bucket's S3 name. With the four `S3_*` below, file contents and avatar clips go to the bucket and a copy of every record is saved there nightly (`backups/records-YYYY-MM-DD.jsonl.gz`, 14 kept) |
| `S3_ENDPOINT` | `${{<bucket>.ENDPOINT}}` |
| `S3_REGION` | `${{<bucket>.REGION}}` (`auto`) |
| `S3_ACCESS_KEY_ID` | `${{<bucket>.ACCESS_KEY_ID}}` |
| `S3_SECRET_ACCESS_KEY` | `${{<bucket>.SECRET_ACCESS_KEY}}` |
| `S3_PATH_STYLE` | Optional `true` for buckets whose Credentials tab says to use path-style URLs |
| `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS` / `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | Without a volume, `30` and `120`: the new API starts before the old one stops, and the old one finishes the replies it's writing |

The image sets `HOST=0.0.0.0`, `PORT=8787` and `DATA_DIR=/data`. For Gmail and Calendar, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register `PUBLIC_API_URL` + `/api/google/callback` as the OAuth redirect URI.

Web push keys and the session signing key are generated on first start and kept in the database, encrypted with `TOKEN_ENCRYPTION_KEY` (a copy left in `/data` by an older version is adopted). Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to supply your own push keys.

### Moving off the volume

1. Add the Postgres database and the bucket; don't connect them yet.
2. In a quiet moment, set `DATABASE_URL` and the `S3_*` variables on the API, keeping the volume attached, and deploy. On start the API checks the bucket (a wrong setting stops the start with the bucket's error), copies every record from PGlite into Postgres and every file into the bucket, and logs `Moved off the server's disk: N records … and M files`. Nothing is overwritten, so a move cut short simply runs again; a marker in Postgres stops it repeating. The health check allows 120 seconds; raise it first for a very large volume.
3. Check sign-in, chats, Files and notifications. To undo, remove `DATABASE_URL` and the `S3_*` variables: the volume is untouched.
4. Detach the volume from the API and set the two overlap variables. Keep the volume for two weeks before deleting it.

To put a nightly copy back, from a checkout with the API's `DATABASE_URL` and `S3_*` set: `pnpm restore-backup backups/records-2026-09-29.jsonl.gz` shows what it holds, and adding `--yes` restores it. Records in the copy replace the current ones; records made since are kept.

## Browser service

- Root directory `apps/worker` (its own Dockerfile), health check path `/health`, watch path `/apps/worker/**`, no public domain.
- Volume mounted at `/data` for browser profiles and downloads.
- Variables: `WORKER_TOKEN` (shared with the API), `WORKER_HOST=::` (listen on the private network), `PORT=8790`, and `RAILWAY_RUN_UID=0` so the image's non-root user can write the root-owned volume.
- The API logs `Agent browser reachable` at startup when the private network path works.

## Web service

- Dockerfile path `infra/web.Dockerfile`, health check path `/`, `PORT=8080` and domain target port `8080`. Caddy serves the export on `PORT`.
- Set `EXPO_PUBLIC_API_URL` to `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`. It is compiled into the bundle, so redeploy the web service after the API domain changes.

Open the web domain and sign in with `OPENMUSE_ACCESS_KEY`. Each device stays signed in for 30 days after its last use. To sign in without typing, open `https://<web domain>/#key=<OPENMUSE_ACCESS_KEY>`; the key is removed from the address bar immediately. Changing `OPENMUSE_ACCESS_KEY` signs every device out.

## People

With `ADMIN_EMAIL` set, the sign-in screen offers **Email me a sign-in link**. Links work once and expire after 15 minutes (invites after 3 days). The admin account owns the original workspace; the access key still opens it.

Invite people under **Apps → People**. Each person gets a private workspace (chat, connected apps, routines, memory, spending limits) and their own agent address, `name@` the `AGENT_EMAIL` domain, which starts with only their own email approved as a sender. Mail to an address nobody uses is ignored; mail that reaches the agent through another address, such as a forwarding alias, goes to the admin. **Remove access** signs the person out everywhere, stops their routines and address, and keeps their data so access can be restored.

With `COMPOSIO_API_KEY` set, the API logs `Connected apps ready (Composio)` at startup. Connect apps under **Apps & settings → More apps** or by asking in chat.

Composio has no ready-made sign-in for some apps, such as Brex. For those, create an auth config for the app in the Composio dashboard (for Brex, choose API Key); **Connect** then uses it and asks for the key on Composio's page. Until one exists, Connect explains what to set up.

The web client installs to a phone's home screen. On iPhone, notifications need the installed app (Share → Add to Home Screen). Store builds use `apps/mobile/eas.json` with an Apple Developer or Google Play account: `npx eas-cli build --platform ios --profile production`.

Purchases through connected apps are off until enabled under **Apps → Spending**, then capped per purchase and per month, and every purchase waits for approval.

## Build locally

```sh
docker build -f infra/api.Dockerfile -t openmuse-api .
docker build -f infra/web.Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example.com -t openmuse-web .
```
