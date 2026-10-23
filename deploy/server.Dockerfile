# API, worker and migrations share one image; the compose service picks the command.
FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pingx/db generate && pnpm --filter @pingx/api --filter @pingx/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 4100
CMD ["node", "apps/api/dist/index.js"]
