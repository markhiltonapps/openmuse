# Deploy to Railway

OpenMuse runs as three Railway services built from this repository: the API (with its task worker), the static web client, and the agent browser. The Linux computer is not covered here.

A reachable deployment must use the live workspace. The sample workspace has no sign-in and refuses a non-loopback `HOST`.

## API service

- Dockerfile path `infra/api.Dockerfile`, health check path `/api/health`, domain target port `8787`.
- Volume mounted at `/data`. It holds PGlite, documents and the session signing key. Run a single replica: PGlite cannot be shared between processes.
- Generate a Railway domain before setting the variables below.

| Variable | Value |
| --- | --- |
| `WORKSPACE_MODE` | `live` |
| `AGENT_BACKEND` | `model` |
| `MODEL` | For example `anthropic/claude-sonnet-5` |
| `ANTHROPIC_API_KEY` | Provider key matching `MODEL` (or `OPENAI_API_KEY` / `GOOGLE_API_KEY`) |
| `CPK_INTELLIGENCE_API_KEY` | Server-only key from `npx copilotkit@latest project select` |
| `OPENMUSE_ACCESS_KEY` | Random secret of at least 24 characters, used to sign in |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `PUBLIC_API_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `ALLOWED_ORIGINS` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `COMPOSIO_API_KEY` | Optional. Connects Outlook, Slack, Notion and 1,000+ more apps through Composio |
| `BROWSER_WORKER_URL` | `http://${{browser.RAILWAY_PRIVATE_DOMAIN}}:8790` |
| `WORKER_TOKEN` | Same random 32+ character secret as the browser service |
| `RESEND_API_KEY` | Optional. Reads email sent to the agent's address |
| `RESEND_WEBHOOK_SECRET` | Signing secret of the Resend `email.received` webhook pointing at `PUBLIC_API_URL` + `/api/inbound/resend` |
| `AGENT_EMAIL` | The agent's address, e.g. `muse@<id>.resend.app` or an address on a receiving domain |
| `AGENT_EMAIL_ALLOWED_SENDERS` | Comma-separated senders who may hand the agent work; editable later in Apps |
| `ADMIN_EMAIL` | Your email. Turns on email sign-in links and lets you invite people; needs `RESEND_API_KEY` |
| `AUTH_EMAIL_FROM` | Optional sender of sign-in emails; defaults to `OpenMuse <signin@` + the `AGENT_EMAIL` domain + `>`, which must be verified for sending in Resend |
| `APP_URL` | Optional web address used in sign-in links; defaults to the first `ALLOWED_ORIGINS` entry |

The image sets `HOST=0.0.0.0`, `PORT=8787` and `DATA_DIR=/data`. For Gmail and Calendar, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register `PUBLIC_API_URL` + `/api/google/callback` as the OAuth redirect URI.

Web push keys are generated on first start and kept in `/data/vapid.json`; set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to supply your own.

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

The web client installs to a phone's home screen. On iPhone, notifications need the installed app (Share → Add to Home Screen). Store builds use `apps/mobile/eas.json` with an Apple Developer or Google Play account: `npx eas-cli build --platform ios --profile production`.

Purchases through connected apps are off until enabled under **Apps → Spending**, then capped per purchase and per month, and every purchase waits for approval.

## Build locally

```sh
docker build -f infra/api.Dockerfile -t openmuse-api .
docker build -f infra/web.Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example.com -t openmuse-web .
```
