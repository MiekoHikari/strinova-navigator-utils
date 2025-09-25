# Copilot instructions for `strinova-navigator-utils`

## Core architecture
- Entry point (`src/index.ts`) bootstraps `SapphireClient`, wires the custom `StatBotClient`, connects to MongoDB, then logs in to Discord.
- `src/lib/setup.ts` is always imported first; it loads `src/.env`, registers Sapphire plugins, sets default guild IDs, and enforces bulk command overwrites—mirror that behavior when adding commands.
- Path alias `#lib/*` -> `src/lib/*` (see `tsconfig.json`). Prefer it over relative imports for shared utilities or models.

## Persistence & data model
- Mongoose models live under `src/lib/db/models/`. Define schemas with `timestamps: true`, index eagerly, and reuse existing field conventions (e.g., weekly reports use `{ guildId, userId, year, week }` unique compound keys).
- Reporting logic relies on `GeneratedReport`, `ModeratorWeeklyPoints`, `EnrolledModerator`, and `ModmailThreadClosure` models. Any schema change must consider backfill routines in `lib/reports.ts` and sync listeners in `listeners/ready*Sync.ts`.

## Reporting & scheduling flows
- `lib/reports.ts` schedules weekly/monthly jobs from `listeners/readyReportsScheduler.ts`. It calls `stardustTally` helpers to aggregate stats, then posts embeds + CSV attachments.
- `lib/stardustTally.ts` orchestrates StatBot API calls and moderation/modmail metrics, persisting normalized weekly documents. Adjust weights via `CATEGORY_CONFIG` and `WEIGHT_BUDGETS`.
- Approval flow: `listeners/modmailMessageCreate.ts` + `listeners/readyModmailSync.ts` parse modmail embeds using `lib/parser/modmailParser.ts`, push approval prompts via `lib/modmailManager.ts`, and update `ModmailThreadClosure` docs.
- Moderation case backfill lives in `listeners/readyCasesSync.ts` with parsing logic in `lib/parser/caseParser.ts`.

## Commands, handlers, and preconditions
- Standard Sapphire commands in `src/commands/**`; subcommands use `@sapphire/plugin-subcommands` (`commands/bablo.ts` is the template for guild-locked logic and DB access).
- Interaction handlers live in `src/interaction-handlers/**`; custom IDs are colon-delimited (`report:create` parsed in `interaction-handlers/button-report.ts`). Keep parse/run symmetry when adding actions.
- Preconditions in `src/preconditions/` gate commands using env-configured role IDs (e.g., `staffOnly`), so new privileged commands should reuse them instead of reimplementing role checks.

## External services & environment
- Required env keys are documented in `src/.env`; use `envParseString` so missing variables throw early. New integrations should extend the declaration in `lib/setup.ts`.
- StatBot API requests go through `lib/api/statbotClient.ts`, which handles retries and rate limits. Always call `container.statBotClient` after `setup` to reuse that client.
- Discord resources/hard-coded IDs (channels, categories) are stored in env vars; avoid literals in code.

## Build, run, and tooling
- Install with `pnpm install`; build with `pnpm run build` (SWC) and start with `pnpm start`. `pnpm watch:start` recompiles via `tsc-watch`; `pnpm watch` keeps SWC in watch mode when you want to hot-reload dist.
- Scaffold new Sapphire pieces via `pnpm sapphire generate <piece>` (`.sapphirerc.json` defines directories).
- Formatting uses `pnpm format` (Prettier via `@sapphire/prettier-config`). Stick to existing linting/logging style (colorette-colored logs, `container.logger`).
- Docker image (`Dockerfile`) expects build artifacts in `dist/` and serves the API healthcheck from `/status` (`routes/status.get.ts`).

## Implementation tips
- Long-running tasks should schedule via `scheduleNextRun` to inherit logging + buffer logic instead of bare `setTimeout`.
- When touching report generation, account for both live runs and backfill: functions like `backfillRecentReports` and `runCurrentPeriodReports` call the same helpers, so keep them idempotent.
- Treat interaction replies as ephemeral when acknowledging button presses unless the existing pattern dictates otherwise, to match current UX.
- Stick to UTC / China Standard Time conversions by reusing helpers in `lib/reports.ts` rather than re-implementing date math.
