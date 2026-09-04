# AGENTS.md — opencode-usage

## Zweck
Lokales Single-User-Dashboard für OpenCode-Token-/Kostenverbrauch.
Datenquelle: `~/.local/share/opencode/opencode.db` (SQLite, IMMER strikt
read-only öffnen). better-sqlite3 v13 unterstützt den `file:?mode=ro`-URI
hier nicht — verwende `new Database(path, { fileMustExist: true, readonly: true })`.
Analyse-DB: `data/stats.db` (better-sqlite3).

**Einzige Schreib-Ausnahme auf die Quell-DB** ist `scripts/prune-source.ts`
(`pnpm prune-source` — Achtung: `pnpm prune` ist pnpm-eigen und nicht unser
Script; Automatik in `pnpm watch`): Retention in KALENDERMONATEN,
konfigurierbar, Default 2 ⇒ Cutoff = 1. des Vormonats (Vorrang
`--cutoff YYYY-MM-DD`/`--days N` > `--months N` > Env `PRUNE_RETENTION_MONTHS`
> 2). Löscht nur `session_message`-Zeilen (Sessions bleiben vorerst), NUR nach
sync → Preflight-Check → Delta-Archiv (nur die gelöschten Zeilen inkl. Roh-JSON →
`~/.local/share/opencode/opencode-prune-archive-YYYYMM.db`, je Cutoff-Monat, klein).
KEINE Vollkopie mehr (war 5,4 GB pro Lauf). `--full`
nach einem Prune braucht `--force` (Guard in extract.ts). Details:
docs/stats-db-schema.md.

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
- `pnpm dev:all` – **Komplette Dev-Umgebung mit EINEM Befehl**: Extractor-Watch
  + Hono-API (:3712) + Vite (:5173), Ausgaben farbig präfixiert ([watch]/[api]/[web]),
  Strg+C beendet alle drei sauber; bricht einer ab, stoppt der ganze Stack.
  API läuft via `tsx watch` (Änderungen an server/** → Auto-Reload), Frontend
  via Vite-HMR — Code-Änderungen brauchen keinen Stack-Neustart.
  In Dev serviert :3712 **nur die API** (NODE_ENV=development, kein stale
  dist/) — das LIVE-Dashboard ist http://localhost:5173/.
  Das ist der normale Weg, am Dashboard zu entwickeln.
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
- Größere Implementierungen an Build-Subagents auslagern; Orchestrator
  koordiniert nur.
