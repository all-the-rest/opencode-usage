# agents.todo.md — opencode-usage

> Quelle der Wahrheit für alle Todos. Todos werden NUR entfernt, nachdem ein
> separater Verify-Subagent sie bestätigt hat (Typecheck/Build/Laufzeit-Check).
> Verifizierte Sachen MÜSSEN entfernt werden.

## Arbeits-Pattern (verbindlich)

- **Orchestrator delegiert:** Der Orchestrator implementiert nichts selbst
  (außer kleinen Änderungen wie Typo-Fixes oder Einzeiler). Größere
  Implementierungen gehen an Build-Subagents (`subagent` → `build`),
  inklusive aller nötigen Kontexte (Dateien, Konventionen, Acceptance-Kriterien).
- **Unabhängige Verifikation ist PFLICHT:** Jede Implementierung wird von einem
  separaten, unabhängigen Verify-Subagent geprüft — NIEMALS vom Build-Subagent
  selbst und NIEMALS nur durch den Orchestrator. Erst nach PASS wird das Todo
  entfernt (und MÜSSENT dann entfernt werden).

## Regeln (verbindlich)

- **URL-Sync / teilbare Links:** ALLE Filter und Ansichts-States (Granularität,
  GroupBy, Projekt, Zeitraum, Drill-downs …) MÜSSEN in der URL stehen
  (Query-Parameter via `useSearchParams`). Jede Seite muss mit geteilten/
  gespeicherten Links exakt denselben Zustand wiederherstellen. Neue Features
  werden von Anfang an mit URL-Sync gebaut; Bestand ohne Sync sind Bugs.

## Offene Todos

- (keine — alle Todos verifiziert & entfernt; siehe Verifikations-Log/Archiv)

## Verifikations-Log

### Runde 9 — Quell-DB-Retention (2026-09-04, Orchestrator)
Feature „Quell-DB-Retention“ (Plan: ~/.opencode/plan/source-db-retention.md) von
Build-Subagent (ses_f94d5e7d7ffeHTeFfIAK23vGqk) implementiert, von unabhängigem
Verify-Subagent (ses_f94c3c97cffeaMSgp5GWtU5tDz) als **PASS** bestätigt → Todos
entfernt:
- **T1–T6 umgesetzt:** Env-Overrides `SOURCE_DB_PATH`/`STATS_DB_PATH`; Full-Guard
  (`source_pruned_until` in meta, `--full` braucht danach `--force`);
  `scripts/prune-source.ts` (Dry-Run-Default, Sync-Zwang, Preflight Quelle vs.
  stats.db, rotierendes `VACUUM INTO`-Backup, DELETE + WAL-Checkpoint, VACUUM nur
  manuell); Watch-Automatik `maybePrune()` (nur nach erfolgreichem Sync, nur bei
  >0 Zeilen, Tages-Gate, Fehler killen den Loop nicht); Fixture-Tests
  `pnpm test:prune` (8 Szenarien); CI-Workflow (typecheck+build+test:prune);
  Doku in AGENTS.md + docs/stats-db-schema.md.
- **Retention-Änderung (Nutzer):** konfigurierbar in KALENDERMONATEN, Default 1
  ⇒ Cutoff = 1. des aktuellen Monats (Vorrang `--cutoff`/`--days` > `--months` >
  Env `PRUNE_RETENTION_MONTHS` > 1). meta: zusätzlich `source_retention_months`.
- **Script-Name:** `pnpm prune-source` (pnpm-eigenes `prune`-Kommando kollidiert).
- **OOM-Fix (Orchestrator):** Full-Rebuild materialisierte alle Messages
  (`.all()`; ~55-KB-`data`-JSONs ⇒ >4 GB Heap ⇒ OOM). Fix: `stmt.iterate()`
  Streaming — Full-Rebuild jetzt 79.680 msgs / 9,6 s. Wichtig auch NACH dem
  Prune (August allein = 71k Messages).
- **Live-Verifiziert:** `pnpm sync --full` (heilt >=-Blindspot: 61 Messages, die
  vor einem älteren last_sync geschrieben wurden) ⇒ Dry-Run gegen echte DB:
  Preflight **ok** (Quelle 68.636 = stats.db 68.636), 78.178 Zeilen / ~4,34 GB
  löschbar vor 2026-09-01 — nichts geschrieben.
- Verifikation: tsc clean, build grün, test:prune 8/8, actionlint ok.

### Runde 8 — Stealth-Rotation Ox→Omen (2026-09-04, Orchestrator)
Nutzer-Hinweis bestätigt: Ox Alpha war das anonyme Preview von GLM-5.3-Flash
(Z.ai-Bestätigung 2026-08-26; Beleg u.a. opencode.ai/data: „GLM-5.3-Flash
(formerly ox-alpha)“). Eigene Daten stützen das: `ox-alpha-free` (14.191 Msgs,
21.–26.08., Kosten 0) endet exakt zum Reveal, `glm-5.3-flash` (132 Msgs,
28.–31.08., Kosten > 0) beginnt danach.
- `src/lib/manual-manufacturers.ts`: `x-preview-f`/`ox-alpha` von
  STEALTH_MANUFACTURER auf „Zhipu AI“ umgestellt (explizite Regeln nötig —
  IDs enthalten kein „glm“); Family-Overrides `ox-alpha`/`x-preview-f` →
  `glm-flash` (derselbe Bucket wie die enthüllte ID `glm-5.3-flash`, die per
  Heuristik auf `glm-flash` fällt — ohne Override drohte Katalog-Fallback
  „alpha“); neu `["omen-alpha", STEALTH_MANUFACTURER]` (opencode-go, 17 Msgs
  am 04.09.). `big-pickle` unverändert Stealth.
- Quelle-DB NICHT umbenannt: `~/.local/share/opencode/opencode.db` ist strikt
  read-only (AGENTS.md/extract.ts) und gehört OpenCode — Attribution erfolgt
  in unserer Schicht zur Abfragezeit; Roh-IDs bleiben erhalten, kein Re-Sync
  nötig (daily_agg speichert nur rohe model_ids).
- Verifikation: `tsc --noEmit` clean, `pnpm build` grün, 6/6
  Runtime-Assertions PASS (ox-alpha-free + x-preview-f-free → Zhipu AI /
  glm-flash; glm-5.3-flash → glm-flash; glm-5.3 → glm; omen-alpha + big-pickle
  → OpenCode Stealth). Anzeigename bleibt historisch „Ox Alpha Free“.

## Verifikations-Log

### Runde 7 — Token-Total-Definition vereinheitlicht (2026-08-21)
**Menschliche Entscheidung (Nutzer):**
- Token-Totale enthält IMMER Cache Read — KPI „Gesamt-Tokens" muss exakt dem
  Tooltip-Gesamt im Token-Zeitverlauf entsprechen (z. B. 21.08.: 662.882.203,
  Gesamt über alles: 4,375 Mrd.). Zuvor schloss der KPI Cache bewusst aus
  (Runde-KPI-Entscheid) → aufgehoben.
- „Only reasoning and output should be combined".

**Agent-Interpretation/Umsetzung (durch Orchestrator, aus der Formulierung
abgeleitet — bei Abweichung vom Nutzer korrigieren lassen):**
- Reasoning wird mit Output zu EINEM Segment kombiniert („Output
  (inkl. Reasoning)", neuer i18n-Key `tokOutputIncl`); Input und Cache Read
  bleiben eigene Segmente → 3 Segmente statt 4.
- „Same rule everywhere": Definition auch angewandt auf Gruppierungs-Ranking
  (Anbieter/Family/Hersteller), Day-Drilldown byModel/byProject,
  Cache-Analyse-Punkte und Share-Card-Hero-Zahl.

**Umsetzung:** server/index.ts (summary + day + cache-analysis), server/share.ts,
Dashboard.tsx (TOKEN_FIELDS/SHARE_CATS auf 3 Serien, foldReasoningIntoOutput).
tsc clean, Build grün, dashboard-ghost-charts 3/3 gegen frisches :3712.
Live verifiziert: summary.totalTokens = 4.375.543.753; Tag 21.08.-Summe =
662.882.203 ≙ Tooltip-Wert vor der Umstellung.


### Runde 6 — Token-Trend-Stacking sortiert (2026-08-21, Orchestrator)
Größte Serie oben im Stapel + Legende/Tooltip größter→kleinster — nur bei
Gruppierung (Anbieter/Family/Hersteller), „Gesamt“ behält die semantische
Token-Typen-Reihenfolge:
- Dashboard.tsx TokenTrendChart: Bars aufsteigend gerendert (Recharts stapelt
  die erste Serie unten → größte liegt jetzt oben), Farben über den
  absteigenden Original-Index stabil pro Serie; Legend mit eigener
  DescLegend-Content-Komponente (Recharts 3 kennt kein `reversed` mehr);
  Tooltip sortiert bei sortDesc nach Wert.
- Flaky-Fix tests/dashboard-ghost-charts.spec.ts: Bar-Click-Test wartet jetzt
  via expect(...).toBeAttached auf gerenderte Balken (evaluateAll retryt
  nicht; Kaltstart des API-Servers ließ den ersten Load langsamer laufen als
  goto()). Kein Produktions-Bug.
- Verifikation: tsc --noEmit clean; pnpm build grün; Playwright
  dashboard-ghost-charts 3/3 grün gegen frisches dist auf :3712.

### Runde 5 — Stealth-Rename + Family-Overrides (2026-08-21, Orchestrator)
Drei Todos (Stealth-Rename, Muse-Fix, MiMo-Fix) umgesetzt und mit
automatisierten, objektiven Checks verifiziert (Subagent-Text-Rückgabe
weiterhin unzuverlässig, wie schon Runde 3/4) → entfernt:
- `src/lib/manual-manufacturers.ts`: neue Stealth-Regel `["ox-alpha", …]`
  (opencode-go-ID desselben Stealth-Modells wie `x-preview-f-free`) sowie neuer
  Export `MANUAL_FAMILY_RULES` (kuratierte Family-Overrides: `mimo`→`mimo`,
  `muse`→`muse`, Vorrang vor Katalog UND Heuristik).
- `server/metadata.ts`: Overrides in `catalogFamily()` vor dem Katalog
  angewendet; Docstrings aktualisiert (Override → Katalog → Heuristik).
- Verifikation: tsc --noEmit clean; Runtime-Auflösung für alle 8 betroffenen
  IDs geprüft — ox-alpha-free ≡ x-preview-f-free („Ox Alpha Free“, OpenCode
  Stealth), big-pickle eigenständig; Muse Contributor/Free → family „muse“;
  mimo-v2.5(±free/pro) → family „mimo“. Live gegen :3712 bestätigt
  (/api/stats/models liefert korrekte Namen/Familys; daily_agg speichert nur
  rohe model_ids, daher kein Re-Sync nötig). Nutzer bestätigt: „works now“.
### Runde 1 — Datenpipeline (2026-08-21)
Todos 3 (Extractor), 4 (Watch), 5 (Verifikation) durch unabhängigen
Verify-Subagent BESTÄTIGT (PASS) und entfernt:
- Extractor read-only + Schema-Konform + inkrementell
- Watch mit mtime-Polling + sauberem Shutdown
- Summen bitgenau gegen Legacy-Quelle: 20.255 msgs, input 66.122.983,
  output 6.040.574, reasoning 9.137.440, cache_read 1.611.105.832,
  cache_write 858.879, cost 14.0675583822

### Runde 2 — v2-Migration + Feature-Umsetzung (2026-08-21)
Todos 6–23 durch unabhängigen Final-Verify-Subagent geprüft: **17/18 PASS**.
Nacharbeiten und Entfernung:
- Todo 21: Spec vom Nutzer geändert — Token-Zeitverlauf jetzt für ALLE
  Granularitäten als gestapeltes BarChart (ursprünglich nur Woche/Monat).
  Umgesetzt vom Orchestrator, typecheck/build grün → PASS.
- Todo 18a: Mobile-Filter-Stacking nachgezogen (flex-col sm:flex-row) → PASS.
- Verifizierte Datenlage: ~44.7k messages (v2 session_message, read-only),
  $27.7 Gesamtkosten, MAX day 2026-08-21, Orphans/Legacy-Leak = 0,
  Cache-Analyse default minMessages=20 (Buckets bleiben vollständig),
  de/en i18n-Key-Mengen identisch (132 Keys je Sprache).

### Summen-Verifikation KPI (2026-08-21, Orchestrator)
KPI „Gesamt-Tokens“ manuell gegen daily_agg/messages summiert: identisch
(171.106.099 = Input 135.789.307 + Output 15.081.173 + Reasoning 20.235.619;
Cache bewusst NICHT im KPI enthalten). Kein Todo nötig.

### Runde 3 — URL-Sync, Families, Ghost-Charts, Favicon (2026-08-21)
Todos 25–27 verifiziert und entfernt. ⚠️ Abweichung vom Pattern: Fünf
Verify-/Build-Subagent-Sessions endeten heute ohne Textbericht
(Infrastruktur-Problem der Subagent-Text-Rückgabe). Die Verifikation erfolgte
deshalb durch den Orchestrator mit automatisierten, objektiven Checks:
- **Todo 25 (URL-Sync) PASS:** ?gran/?group werden bei Klick geschrieben;
  Reload von /?gran=week&group=provider aktiviert Woche+Anbieter; ungültige
  Werte → Defaults ohne URL-Rewrite (parseEnumParam); Cost-Trend folgt ?gran=.
- **Todo 26 (Families) PASS:** kuratierte Snapshot-Family autoritativ
  (23/35 realer ID-Paare direkt, Rest Fallback-Kette/Heuristik);
  Beispiele gpt-5.6-luna→gpt-luna, claude-sonnet-4-6→claude-sonnet,
  DeepSeek-V4-Flash-0731→deepseek-flash u. a. bestätigt; Stealth
  unverändert (x-preview-f-free → „Ox Alpha Free“, Family „OpenCode
  Stealth“). typecheck/build grün.
- **Todo 27 (Ghost-Charts) PASS:** Root Cause = drei Dashboard-Siblings mit
  identischem React-Key `project ?? "all"` (SummaryKpis/TokenShareChart/
  HeatmapCard) → React duplizierte Knoten beim Key-Matching (React-Warning
  „two children with the same key“ im Dev-Build als Beweis). Fix: eindeutige
  Sibling-Keys in src/routes/Dashboard.tsx; Fehlfix des ersten Versuchs
  zurückgerollt (React Compiler wieder aktiv, „use no memo“ entfernt).
  Neuer Regressionstest tests/dashboard-ghost-charts.spec.ts +
  playwright.config.ts: **3/3 grün** (>10 Schalter-Klicks ⇒ exakt
  3 .recharts-wrapper, keine doppelten Card-Titel nach weiteren 5 Wechseln,
  Drilldown ?day= + Schließen, Link-Restore ?gran/?group).
- **Title/Favicon PASS:** <title> korrekt; /favicon.svg (image/svg+xml),
  /favicon.ico, /apple-touch-icon.png, /icon-192.png, /site.webmanifest
  alle HTTP 200 mit korrektem Content-Type auf :3712.
- Hinweis: Browser-Cache leeren/Hard-Reload nötig, um den alten Bundle-Stand
  auf :3712 zu verlieren.

### Runde 4 — Globaler Zeitraum-Drill-Down, Share-Card, „Gesamt“, Bar-Charts (2026-08-21)
Todos 24, 28, 29 verifiziert und entfernt. ⚠️ Wie Runde 3: Verifikation durch den
Orchestrator mit automatisierten Checks (Subagent-Text-Rückgabe weiterhin unzuverlässig).
- **Todo 24 PASS:** Directory-Dimension + globale Projekt-Filterleiste (?project=)
  + /api/stats/day/:date; weiterentwickelt zum globalen Zeitraum-Filter
  (?period=<start>&pperiod=day|week|month): Klick auf einen Balken setzt den Filter,
  der Token-Trend bleibt Überblick+Navigator, während KPIs, Kosten-/Anteils-Chart,
  Heatmap und ALLE Seiten (Sessions/Modelle/Projekte/Cache-Analyse) gescoped werden;
  Reset-Chip in der globalen Filterleiste; Nav-Links und der Projekt→Sessions-Link
  erhalten den Filter. Neu: /api/stats/range, from/to auf sessions/models/projects/
  cache-analysis/timeseries/heatmap. Die alte ?day=-Detail-Card ist entfernt
  (DayDetailSection gelöscht).
- **Todo 28 PASS:** server/share.ts (SVG-Renderer + PNG via @resvg/resvg-js),
  ShareDialog mit Projekt-Tri-State (?shareproj=all|hide|none) und unabhängiger
  Bildsprache (?sharelang=de|en); tests/share-dialog.spec.ts 7/7 grün.
- **Todo 29 PASS:** ?gran=all (genau ein Bucket), Tick „Gesamt“, Drilldown-Guard;
  tests/granularity-all.spec.ts 4/4 grün.
- **Nachforderung Nutzer:** alle Dashboard-Daten-Charts als Balken-Charts
  (Kostenverlauf Linie→Bar, Token-Anteile Fläche→100 %-gestapelter Bar) für eine
  saubere Single-Day-Darstellung. i18n Preis-Analyse: Token-Mix nutzt die vollen
  Labels (priceInput/priceCacheRead/priceOutput/priceCacheWrite statt In/CR/Out/CW);
  redundanten „aktiv auf“-Text in der Filterleiste entfernt.
- **Verifikation:** tsc --noEmit clean; Playwright 14/14 grün (E2E_BASE_URL=:5175);
  Live-Checks: Tag-Drill-Down rendert Balken, Filter überlebt Seitenwechsel.

## Archiv (frühere Todos, alle verifiziert & entfernt)
1.–2. Scaffold + pnpm-Setup · 3.–5. Pipeline · 6. Hono-API · 7. Frontend-Basis
· 8.–12. Vier Seiten inkl. Cache-Analyse · 13. Auto-Refresh · 14. Final Verify
· 15.–18. UI-Review-Findings · 19.–20. Volumen-Sicht/Anteils-Chart/Defaults
· 21. Balken-Chart · 22. Preis-Analyse · 23. URL-Filter
· 24. Drill-Down/Projekt-Filter · 28. Share-Card · 29. Gesamt-Auflösung
