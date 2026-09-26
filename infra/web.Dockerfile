# OpenMuse web client (Expo web export) served as static files.
# EXPO_PUBLIC_API_URL is compiled into the bundle, so rebuild when the API URL changes.
# Build from the repository root:
#   docker build -f infra/web.Dockerfile --build-arg EXPO_PUBLIC_API_URL=https://api.example.com -t openmuse-web .
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mobile/package.json apps/mobile/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter openmuse --filter @openmuse/mobile
COPY . .
ARG EXPO_PUBLIC_API_URL
RUN test -n "$EXPO_PUBLIC_API_URL" || { echo "Set EXPO_PUBLIC_API_URL to the public API URL" >&2; exit 1; }
RUN pnpm --dir apps/mobile exec expo export --platform web --output-dir dist/web

FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/mobile/dist/web /srv
