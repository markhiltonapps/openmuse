# Deploy to Railway

OpenMuse runs as two Railway services built from this repository: the API (with its task worker) and the static web client. The browser worker and Linux computer are not covered here.

A reachable deployment must use the live workspace. The sample workspace has no sign-in and refuses a non-loopback `HOST`.

## API service

- Config file: `infra/railway/api.json` (builds `infra/api.Dockerfile`, health check `/api/health`).
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

The image sets `HOST=0.0.0.0` and `DATA_DIR=/data`; Railway supplies `PORT`. For Gmail and Calendar, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register `PUBLIC_API_URL` + `/api/google/callback` as the OAuth redirect URI.

## Web service

- Config file: `infra/railway/web.json` (builds `infra/web.Dockerfile`, served by Caddy on `PORT`).
- Set `EXPO_PUBLIC_API_URL` to `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`. It is compiled into the bundle, so redeploy the web service after the API domain changes.

Open the web domain and sign in with `OPENMUSE_ACCESS_KEY`.

## Build locally

```sh
docker build -f infra/api.Dockerfile -t openmuse-api .
docker build -f infra/web.Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example.com -t openmuse-web .
```
