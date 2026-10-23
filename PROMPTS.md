# Prompts for Claude Code

Run these from the repo root. Use plan mode (Shift+Tab) for the first message of each milestone, review the plan, then let it build.

## 0. First session (kickoff)

```
Read CLAUDE.md, docs/PINGX_PLAN.md and docs/PROGRESS.md fully.
We are starting PingX. Before writing any code:
1. Summarise the product, v1 scope and out-of-scope in 10 lines so I can confirm you understood.
2. List anything in the plan that is ambiguous or contradictory.
3. Propose the exact repo scaffold (folders, package names, root scripts, turbo pipeline) for M1.
Wait for my OK before creating files.
```

## 1. R&D spikes

```
Work on the R&D section of docs/PROGRESS.md. Create /spikes with one small
standalone script per spike (TypeScript, tsx). Start with the SMTP egress spike:
send a test mail via Nodemailer using SMTP_HOST/PORT/USER/PASS from .env for
ports 465 and 587, print timing and the full error on failure.
After each spike write docs/spikes/<name>.md: what we tested, result, decision.
```

## 2. Milestone kickoff (repeat for M1…M6)

```
Start milestone M<N> from docs/PROGRESS.md.
Read its section in docs/PINGX_PLAN.md plus Data model and API design.
Give me a plan: tasks in order, files per task, tests per task, risks.
Then implement task by task. After each task: run lint, typecheck, tests;
tick it in PROGRESS.md; commit with a conventional message. Stop and ask
if something in the plan doesn't fit.
```

## 3. Single task

```
Do the next unchecked task in docs/PROGRESS.md. Follow CLAUDE.md rules.
```

## Useful one-offs

```
Write the Prisma schema for every table in the Data model section of
docs/PINGX_PLAN.md, with the listed indexes, enums for statuses, and a seed
for Free (200/day), Starter (2000/day, ₹199), Pro (10000/day, ₹699).
```

```
Implement the email fallback chain in apps/worker: load the user's healthy
providers ordered by priority (project default first if set), try each,
classify errors as provider-side vs recipient-side, log one message_event per
attempt, mark a provider unhealthy after 5 consecutive auth failures.
Add unit tests for the error classifier and the chain.
```

```
Review the codebase against the Security section of docs/PINGX_PLAN.md and
CLAUDE.md. List every violation with file:line and fix them.
```

## Session hygiene

- Start each day with: `Read docs/PROGRESS.md and summarise where we are and what's next.`
- When context gets long: `/compact` (keeps a summary) or `/clear` and start fresh — CLAUDE.md and PROGRESS.md bring it back up to speed.
- Something it must always remember → add one line to CLAUDE.md (or press `#` in Claude Code to add a memory).
