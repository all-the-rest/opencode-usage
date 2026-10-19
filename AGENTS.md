# AGENTS.md — opencode-usage

> **Nur Regeln, keine Entscheidungen:** Diese Datei enthält ausschließlich Regeln — Anweisungen, die für jede Arbeit in diesem Repo gelten. Dauerhafte Entscheidungen, Begründungen, Messwerte und Historie gehören nicht hierher, sondern in `docs/`/`features/` bzw. die Projekt-Doku; offene Punkte nach `agents.todo.md`; Erledigtes in die Git-Historie.

## Zweck
Lokales Single-User-Dashboard für OpenCode-Token-/Kostenverbrauch.
Datenquelle: `~/.local/share/opencode/opencode.db` (SQLite) — IMMER strikt
read-only öffnen via `new Database(path, { fileMustExist: true, readonly: true })`
(nicht per `file:?mode=ro`-URI). Analyse-DB: `data/stats.db` (better-sqlite3).

**Einzige Schreib-Ausnahme auf die Quell-DB** ist `scripts/prune-source.ts`
(`pnpm prune-source` — `pnpm prune` ist pnpm-eigen, NICHT unser Script;
Automatik in `pnpm watch`): Retention in Kalendermonaten, konfigurierbar
(Vorrang `--cutoff`/`--days` > `--months` > `PRUNE_RETENTION_MONTHS` > Default).
Löscht nur `session_message`-Zeilen und NUR in der Reihenfolge
sync → Preflight → Delta-Archiv → Delete (Archiv je Cutoff-Monat:
`~/.local/share/opencode/opencode-prune-archive-YYYYMM.db`). `--full` nach einem
Prune braucht `--force`. Details/Defaults: docs/stats-db-schema.md.

## Konventionen
- pnpm, Node >= 22, TypeScript strict (`noUncheckedIndexedAccess` an).
- React 19 + React Compiler (vite.config): keine manuellen useMemo/useCallback
  nötig — Compiler memoized.
- React Router v8 (`react-router` Paket, `createBrowserRouter`).
- Tailwind CSS 4 (@tailwindcss/vite) + daisyUI 5. Theme folgt System
  (prefers-color-scheme), siehe index.html Inline-Script.
- Charts: Recharts 3. Heatmap als CSS-Grid selbst bauen.
- i18n: eigenes `src/lib/i18n.ts` (Muster
  `~/dev/ocgo-price-tracker/src/i18n.ts`): `Lang = "de" | "en"`,
  Plain-Object-Dictionary, `{placeholder}`-Interpolation, keine Library.
- Model-Metadaten: `@opencode-ai/models` → `make().providers()` (ProviderMap:
  provider.id/name, models mit id/name/family/limit/cost).
- Server: Hono + @hono/node-server, Port 3712. In dev proxied via vite
  (/api → localhost:3712). `pnpm start` serviert API + dist/ statisch.

## Befehle
- `pnpm dev:all` – **Komplette Dev-Umgebung mit EINEM Befehl**: Extractor-Watch
  + Hono-API (:3712) + Vite (:5173), präfixierte Ausgaben ([watch]/[api]/[web]);
  Strg+C beendet alle sauber, bricht einer ab, stoppt der ganze Stack. API via
  `tsx watch` (server/** → Auto-Reload), Frontend via Vite-HMR — Code-Änderungen
  brauchen keinen Stack-Neustart. In Dev serviert :3712 **nur die API**; das
  LIVE-Dashboard ist http://localhost:5173/ — der normale Weg, am Dashboard zu
  entwickeln.
- `pnpm sync` – Extractor einmalig / inkrementell (nötig, wenn stats.db hinter
  opencode.db zurückhängt, z. B. nach Reboot ohne Watch)
- `pnpm watch` – Extractor Watch-Modus (allein)
- `pnpm dev` – NUR Vite Dev-Server (kein API-Proxy-Ziel → 502, wenn `pnpm start`
  nicht separat läuft)
- `pnpm build` – tsc --noEmit && vite build
- `pnpm typecheck` – tsc --noEmit
- `pnpm start` – Hono-API + statisches Frontend (Produktionsart auf :3712)

### Startup-Checkliste (Dev)
1. `pnpm dev:all` (oder einzeln: `pnpm watch` + `pnpm start` + `pnpm dev`)
2. Dashboard: http://localhost:5173/ — Daten kommen aus `data/stats.db`;
   ohne laufenden Watch/Sync fehlt der aktuelle Tag (Heilung: `pnpm sync`).

## Workflow (wichtig)
- `agents.todo.md` ist die Todo-Quelle der Wahrheit. Neue Todos dort eintragen.
- Todos nur entfernen, wenn ein separater Verify-Subagent sie bestätigt hat.
  Verifizierte MÜSSEN entfernt werden.
- Repo-spezifische Kommandos: **Befehle** oben.
