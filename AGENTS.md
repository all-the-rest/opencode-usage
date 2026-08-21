# AGENTS.md — opencode-usage

## Zweck
Lokales Single-User-Dashboard für OpenCode-Token-/Kostenverbrauch.
Datenquelle: `~/.local/share/opencode/opencode.db` (SQLite, IMMER strikt
read-only öffnen). better-sqlite3 v13 unterstützt den `file:?mode=ro`-URI
hier nicht — verwende `new Database(path, { fileMustExist: true, readonly: true })`.
Analyse-DB: `data/stats.db` (better-sqlite3).

## Konventionen
- pnpm, Node >= 22, TypeScript strict (`noUncheckedIndexedAccess` an).
- React 19 + React Compiler (babel-plugin-react-compiler in vite.config).
  Keine manuellen useMemo/useCallback nötig — Compiler memoized.
- React Router v8 (`react-router` Paket, `createBrowserRouter`).
- Tailwind CSS 4 (@tailwindcss/vite) + daisyUI 5. Theme folgt System
  (prefers-color-scheme), siehe index.html Inline-Script.
- Charts: Recharts 3. Heatmap als CSS-Grid selbst bauen.
- i18n: eigenes `src/lib/i18n.ts`, Muster wie ~/dev/ocgo-price-tracker/src/i18n.ts:
  `Lang = "de" | "en"`, Plain-Object-Dictionary, `{placeholder}`-Interpolation,
  KEINE i18n-Library.
- Model-Metadaten: `@opencode-ai/models` → `make().providers()` (ProviderMap:
  provider.id/name, models mit id/name/family/limit/cost).
- Server: Hono + @hono/node-server, Port 3712. In dev proxied via vite
  (/api → localhost:3712). `pnpm start` serviert API + dist/ statisch.

## Befehle
- `pnpm sync` – Extractor einmalig / inkrementell
- `pnpm watch` – Extractor Watch-Modus
- `pnpm dev` – Vite Dev-Server (API separat: `pnpm start`)
- `pnpm build` – tsc --noEmit && vite build
- `pnpm typecheck` – tsc --noEmit
- `pnpm start` – Hono-API + statisches Frontend

## Workflow (wichtig)
- `agents.todo.md` ist die Todo-Quelle der Wahrheit. Neue Todos dort eintragen.
- Todos nur entfernen, wenn ein separater Verify-Subagent sie bestätigt hat.
  Verifizierte MÜSSEN entfernt werden.
- Größere Implementierungen an Build-Subagents auslagern; Orchestrator
  koordiniert nur.
