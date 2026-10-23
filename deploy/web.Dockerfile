FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_TURNSTILE_SITE_KEY=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN pnpm install --frozen-lockfile --filter @pingx/dashboard...
RUN pnpm --filter @pingx/dashboard build

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/dashboard/dist /srv
