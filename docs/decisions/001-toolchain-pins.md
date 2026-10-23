# 001 — Toolchain version pins

## Context
On 2026-10-23, the latest npm versions include TypeScript 7 (native port, no JS compiler API), Prisma 7 (datasource config moved out of the schema), and Zod 4.

## Decision
- TypeScript `^6`: typescript-eslint and tsup `--dts` need the JS compiler API.
- Prisma `^6`: the classic `url = env("DATABASE_URL")` schema and `prisma-client-js`.
- Zod `^3`: stable API. Move to 4 only in a dedicated task.
- Internal packages (`@pingx/*`) export TS source. Apps bundle them with tsup (`noExternal: [/^@pingx\//]`), and dev runs them through tsx. Only `pingx` (the SDK) has its own build.
- pnpm 12 blocks dependency build scripts. The allowed ones are listed under `allowBuilds` in `pnpm-workspace.yaml`.

## Why
This avoids fighting ecosystem breakage during M1. Revisit at M6 hardening.
