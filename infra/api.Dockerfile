# OpenMuse API, CopilotKit runtime and task worker.
# Build from the repository root: docker build -f infra/api.Dockerfile -t openmuse-api .
# Docker Hub limits pulls from Railway's shared builders (429); Google's mirror has the same images.
FROM mirror.gcr.io/library/node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mobile/package.json apps/mobile/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter openmuse
COPY tsconfig.json tsconfig.build.json ./
COPY apps/server apps/server
COPY packages packages
RUN pnpm build:server

FROM mirror.gcr.io/library/node:24-slim
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/mobile/package.json apps/mobile/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --filter openmuse
COPY --from=build /app/dist ./dist
# Runs as root so a mounted volume at DATA_DIR stays writable on hosts that mount volumes root-owned.
# Sample mode refuses a non-loopback HOST; a reachable container must use WORKSPACE_MODE=live.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["node", "dist/apps/server/src/index.js"]
