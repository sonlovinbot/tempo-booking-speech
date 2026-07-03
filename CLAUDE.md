# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Tempo** is a Vietnamese-language mobile web app: speak your tasks out loud → they're transcribed, parsed by AI into structured tasks (with dates/times/durations), and added to your Google Calendar for the day. The UI copy is in Vietnamese; keep new user-facing strings in Vietnamese to match.

## Commands

Package manager is **Bun** (`bun.lock`, `bunfig.toml`). Use `bun` / `bunx`.

| Task | Command |
| --- | --- |
| Dev server | `bun dev` (→ `vite dev`) |
| Production build | `bun run build` (→ `vite build`) |
| Dev-mode build | `bun run build:dev` (→ `vite build --mode development`) |
| Preview build | `bun run preview` |
| Lint | `bun run lint` (→ `eslint .`) |
| Format | `bun run format` (→ `prettier --write .`) |

There is **no test framework** configured and no typecheck script — `tsconfig.json` is `noEmit`. Run `bunx tsc --noEmit` if you need a type check.

## Stack

- **TanStack Start** (full-stack React w/ SSR) — *not* Next.js or Remix. React 19, Vite 8, Nitro build targeting Cloudflare Workers by default.
- **TanStack Router** (file-based routing) + **TanStack React Query**.
- **Tailwind CSS v4** (`@tailwindcss/vite`, config-less; theme lives in `src/styles.css` via `@theme inline` + oklch tokens). Dark mode is forced (`<html class="dark">`).
- **shadcn/ui** — new-york style, slate base, in `src/components/ui/`. Radix + CVA + `cn()` from `@/lib/utils`.
- **Zod** for validation, **Bun** package manager, deployed via **Lovable**.

## Architecture

### Server functions (RPC pattern)
Backend logic lives in `createServerFn(...)` calls inside `src/lib/*.functions.ts`. The client invokes them with `useServerFn(fn)` and calls `fn({ data })`:
- `tempo.functions.ts` — `transcribeAudio`, `parseTasks`, `listTodayEvents`, `createEvent`.
- `google.functions.ts` — `getGoogleAuthUrl`, `connectGoogle`, `googleStatus`, `disconnectGoogle` (Google Calendar OAuth). The server-only OAuth/token/cookie logic lives in `google.server.ts` (imported dynamically).

**Server-only code convention:** truly server-only implementation (Node crypto, secrets) belongs in a `*.server.ts` file, imported **dynamically inside the handler** (`await import("./x.server")`) so it never leaks into the client bundle. Do **not** install/import the `server-only` npm package — ESLint blocks it; use the `*.server.ts` naming or `@tanstack/react-start/server-only`.

### Access & Google Calendar connection
The app is **public** — no password gate; `/` loads directly. Google Calendar uses **per-browser OAuth**: the first time a session needs the calendar (in `stopAndSubmit`, before `listTodayEvents`), `index.tsx` shows a "Kết nối Google Calendar" modal → a **popup** (`window.open`) runs Google OAuth → `/auth/callback` (`src/routes/auth.callback.tsx`) exchanges the code and stores the **refresh token in an encrypted session cookie** (`useSession`, name `tempo-google`, needs `SESSION_SECRET`). The popup `postMessage`s `"google-connected"` back to the opener. `google.server.ts#getAccessToken()` swaps that refresh token for an access token (best-effort in-memory cache) on each calendar call; on `invalid_grant` it clears the cookie so the client re-prompts. (An earlier build gated the whole site behind a password `/unlock` screen; that was removed.)

### Core voice→calendar pipeline (`src/routes/index.tsx`)
1. **Record** in-browser via Web Audio API (`ScriptProcessorNode`), collecting Float32 chunks + a live level meter.
2. **Encode**: downsample to 16 kHz mono → PCM16 → WAV → base64 (all client-side helpers at the top of the file).
3. **`transcribeAudio`** → Groq Whisper (`whisper-large-v3`, `language: "vi"`) at `https://api.groq.com/openai/v1`.
4. **`parseTasks`** → DeepSeek (`deepseek-chat`) at `https://api.deepseek.com` with a large Vietnamese system prompt that extracts `{ title, durationMin, explicitStart, explicitEnd, explicitDate, description }[]` as strict JSON (`response_format: json_object`). Relative Vietnamese dates/times ("ngày mai", "3 giờ chiều", "tuần sau") are resolved against **Asia/Ho_Chi_Minh** "now".
5. **`listTodayEvents`** → Google Calendar API directly (`https://www.googleapis.com/calendar/v3`, OAuth bearer from `google.server.ts`) for today's busy blocks.
6. **Client scheduling**: `findSlot()` packs auto-scheduled (non-explicit) tasks into free gaps, avoiding busy blocks; explicit times are honored as-is. User reviews/edits each task, then **`createEvent`** writes it (supports reminders + optional Google Meet link).

### Timezone
Everything is **Asia/Ho_Chi_Minh (+07:00)**. The server may run in UTC, so date math is done via `Intl.DateTimeFormat` parts and explicit `+07:00` ISO strings rather than local `Date` methods. Preserve this pattern when touching date logic.

### External services
Direct provider APIs (no Lovable gateway), all called with `fetch` (Workers-safe):
- STT: Groq `https://api.groq.com/openai/v1/audio/transcriptions` (auth: `GROQ_API_KEY`).
- Parse: DeepSeek `https://api.deepseek.com/chat/completions` (auth: `DEEPSEEK_API_KEY`). OpenAI-compatible.
- Calendar: Google `https://www.googleapis.com/calendar/v3/...` (auth: OAuth access token) + token endpoint `https://oauth2.googleapis.com/token` (auth: `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + the stored refresh token).

### Error handling
Custom SSR error wrapping: `src/server.ts` (catches catastrophic/h3-swallowed SSR 500s and renders `renderErrorPage()`), `src/start.ts` (request middleware), `src/lib/error-capture.ts`, and `src/lib/lovable-error-reporting.ts` (reports to `window.__lovableEvents` + the root `errorComponent`).

### Environment variables (secrets, set in Lovable / `.dev.vars` — not committed)
`GROQ_API_KEY` (STT), `DEEPSEEK_API_KEY` (parse), `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (Google OAuth Web client), `SESSION_SECRET` (≥32 chars, encrypts the `tempo-google` cookie). Handlers throw descriptive Vietnamese errors when any are missing. See `.dev.vars.example`. The old `LOVABLE_API_KEY` / `GOOGLE_CALENDAR_API_KEY` are no longer used.

## Critical constraints

- **Do not add Vite plugins that `@lovable.dev/vite-tanstack-config` already provides** (tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, componentTagger, `@` alias, env injection, error loggers). Duplicating them breaks the app. Extra config goes through `defineConfig({ vite: { ... } })` in `vite.config.ts`.
- **`src/routeTree.gen.ts` is auto-generated** — never edit by hand.
- **File-based routing only** (see `src/routes/README.md`): every `.tsx` in `src/routes/` is a route; `__root.tsx` is the only shell. No `src/pages/`, no `app/layout.tsx`, no Next.js/Remix conventions. Dynamic segments use bare `$` (e.g. `users/$id.tsx`).
- **Lovable git sync**: don't rewrite published history (no force-push / rebase / amend / squash of pushed commits). Commits on the connected branch sync to Lovable, so keep the branch in a working state.
- **`bunfig.toml` enforces a 24h supply-chain guard** (`minimumReleaseAge`); adding a package published <24h ago requires a per-package exclude — confirm with the user first.
- Path alias `@/*` → `src/*`. Prettier: 100 cols, double quotes, semis, trailing commas.
