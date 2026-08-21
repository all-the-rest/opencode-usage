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
<!-- Todos 3 (Extractor), 4 (Watch-Modus), 5 (Verifikation) am 2026-08-21
     durch unabhängigen Verify-Subagent BESTÄTIGT (PASS) und entfernt:
     - Extractor read-only + Schema-Konform + inkrementell
     - Watch mit mtime-Polling + sauberem Shutdown
     - Summen bitgenau: 20.255 msgs, input 66.122.983, output 6.040.574,
       reasoning 9.137.440, cache_read 1.611.105.832, cache_write 858.879,
       cost 14.0675583822; typecheck grün -->

## API
- [ ] 6. Hono-Server `server/index.ts`: Endpunkte /api/stats/summary,
       /timeseries, /models, /projects, /sessions, /cache-analysis, /meta;
       serviert dist/ statisch; Port 3712; Shared Types in src/lib/types.ts
       <!-- IMPLEMENTIERT (commit 4079eba): alle Endpunkte per curl gegen
            echte Daten getestet (summary cost 14.0676, meta 20255 msgs,
            cache-analysis pearson +0.2955, buckets 0.504→0.970);
            wartet auf Verify im Final Check -->

## Frontend
- [ ] 7. Basis: main.tsx mit Router, Layout + Navbar (4 Seiten), i18n
       (src/lib/i18n.ts, de/en, {placeholder}-Interpolation wie
       ocgo-price-tracker), Theme folgt System, api client (src/lib/api.ts)
       <!-- IMPLEMENTIERT (commit 9b7e509 + Pfad-Fix fba749a);
            wartet auf Verify im Final Check -->
- [ ] 8. Dashboard-Seite: KPI-Karten, Token-Zeitverlauf gestapelt
       (umschaltbar provider/family), Kostenverlauf
       <!-- IMPLEMENTIERT: inkl. Heatmap (Woche×Stunde), Granularity/GroupBy-
            Umschalter; wartet auf Verify -->
- [ ] 9. Modelle-Seite: Breakdown nach Familie & Hersteller (Tokens, Kosten,
       Cache-Ratio), Anreicherung via @opencode-ai/models
       <!-- IMPLEMENTIERT: models.dev-Snapshot offline via
            @opencode-ai/models/snapshot; wartet auf Verify -->
- [ ] 10. Projekte-Seite: Kosten/Tokens pro Projekt (Tabelle + Balken)
       <!-- IMPLEMENTIERT; wartet auf Verify -->
- [ ] 11. Sessions-Seite: Liste mit Filter/Sortierung, Detail mit
        Nachrichtenanzahl, Cache-Hit-Ratio, Token-Verlauf
        <!-- IMPLEMENTIERT: sortierbare Header, Pagination, Client-Filter,
             Expandable-Detail mit radial-progress; wartet auf Verify -->
- [ ] 12. Cache-Analyse: Scatterplot Nachrichtenanzahl vs. Cache-Hit-Ratio
        (cache.read / (input+cache.read+cache.write)) mit Korrelationskennzahl
        <!-- IMPLEMENTIERT: Scatter + Regressionsgerade + Pearson-KPI +
             Bucket-Balken; echte Daten: pearson +0.296, Buckets
             0.504→0.970; wartet auf Verify -->
- [ ] 13. Auto-Refresh alle 60s (Polling) + lastSync-Anzeige

## UI Review (Skill-Ansatz)
- [ ] 15. UI-Review-Runde via ui-review Skill: Playwright-Screenshots aller
        4 Seiten (leerer State + State mit echten Daten aus laufender API),
        Analyse durch Vision-Subagent, daraus abgeleitete Verbesserungs-Todos
        hier eintragen und umsetzen

## Final
- [ ] 14. Final verify: typecheck, vite build, pnpm start E2E gegen echte DB
        (API liefert echte Zahlen, Seiten rendern)
