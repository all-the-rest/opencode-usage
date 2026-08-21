# agents.todo.md — opencode-usage

> Quelle der Wahrheit für alle Todos. Todos werden NUR entfernt, nachdem ein
> separater Verify-Subagent sie bestätigt hat (Typecheck/Build/Laufzeit-Check).
> Verifizierte Sachen MÜSSEN entfernt werden.

## Setup
- [ ] 1. Scaffold: Vite 8 + React 19 + TS strict + pnpm, React Compiler
      (babel-plugin-react-compiler), React Router v8, Tailwind 4 + daisyUI 5
      (System-Theme via prefers-color-scheme), .gitignore, git init
- [ ] 2. pnpm install inkl. better-sqlite3 Build-Approval (pnpm-workspace.yaml)

## Datenpipeline
- [ ] 3. Extractor `scripts/extract.ts`: read-only Zugriff auf
       `~/.local/share/opencode/opencode.db` (`file:...?mode=ro`), flattening
       der message.data JSONs (tokens input/output/reasoning/cache.read/
       cache.write, cost, modelID, providerID, time), Aufbau Analyse-DB
       `data/stats.db` mit Tabellen messages, sessions_agg, daily_agg,
       project_agg, meta; inkrementell ab meta.last_sync
- [ ] 4. Watch-Modus `scripts/watch.ts`: mtime-Polling auf opencode.db(-wal),
       inkrementeller Re-Sync bei Änderung
- [ ] 5. Verifikation Extractor: Aggregate (Summen Tokens/Kosten, Message-
       Counts) gegen direkte SQL-Queries auf opencode.db abgleichen

## API
- [ ] 6. Hono-Server `server/index.ts`: Endpunkte /api/stats/summary,
       /timeseries, /models, /projects, /sessions, /cache-analysis, /meta;
       serviert dist/ statisch; Port 3712; Shared Types in src/lib/types.ts

## Frontend
- [ ] 7. Basis: main.tsx mit Router, Layout + Navbar (4 Seiten), i18n
       (src/lib/i18n.ts, de/en, {placeholder}-Interpolation wie
       ocgo-price-tracker), Theme folgt System, api client (src/lib/api.ts)
- [ ] 8. Dashboard-Seite: KPI-Karten, Token-Zeitverlauf gestapelt
       (umschaltbar provider/family), Kostenverlauf
- [ ] 9. Modelle-Seite: Breakdown nach Familie & Hersteller (Tokens, Kosten,
       Cache-Ratio), Anreicherung via @opencode-ai/models
- [ ] 10. Projekte-Seite: Kosten/Tokens pro Projekt (Tabelle + Balken)
- [ ] 11. Sessions-Seite: Liste mit Filter/Sortierung, Detail mit
        Nachrichtenanzahl, Cache-Hit-Ratio, Token-Verlauf
- [ ] 12. Cache-Analyse: Scatterplot Nachrichtenanzahl vs. Cache-Hit-Ratio
        (cache.read / (input+cache.read+cache.write)) mit Korrelationskennzahl
- [ ] 13. Auto-Refresh alle 60s (Polling) + lastSync-Anzeige

## Final
- [ ] 14. Final verify: typecheck, vite build, pnpm start E2E gegen echte DB
        (API liefert echte Zahlen, Seiten rendern)
