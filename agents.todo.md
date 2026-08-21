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

- [ ] 24. Großes Drill-Down-Feature (Nutzerwunsch „voll interaktiv, Drill-down
        überall"):
        a) Schema: directory-Dimension in daily_agg + hourly_agg, Extractor,
           Komplett-Rebuild + Verifikation
        b) Server: ?dir=<basename> Filter auf ALLEN /api/stats/* Endpunkten;
           NEU /api/stats/day/:date (KPIs, Top-Modelle, Top-Projekte,
           Stundenverlauf, aktive Sessions des Tages); sessions?dir=
        c) Frontend: globale Projekt-Filterleiste im Layout (?dir= via URL,
           Badge mit ✕); Dashboard reagiert auf dir; Klick auf Balken/
           Anteils-Chart/Heatmap-Zelle setzt ?day=YYYY-MM-DD → Tages-
           Detail-Sektion (teilbar); Projects: „Sessions anzeigen"-Deep-Link
           (/sessions?dir=…); Sessions liest ?dir=; alle Seiten kombinieren
           dir + bestehende Filter
        d) i18n de/en für alle neuen Labels

- [ ] 28. Share-Card „Token-Statistik als Social-Media-Bild“ (Plan:
          ~/.opencode/plan/share-image.md):
          a) Server: GET /api/stats/share (JSON-Aggregation Heute/Woche/
             Monat, optional ?project=, ?hideProjects=1, ?lang=de|en),
             /api/stats/share.svg (1200×630 SVG-String-Renderer, dunkles
             Design, #422ad5-Akzent), /api/stats/share.png (@resvg/resvg-js,
             ist bereits installiert). Rekorde: längste Session (Dauer),
             größte Session (Tokens), beste Cache-Hit-Rate (msg_count ≥ 20),
             stärkster Tag; Top-5-Projekte aus daily_agg (day+directory).
          b) Frontend: Teilen-Button am Dashboard, daisyUI-Modal mit Range-
             Segmenten, Vorschau (<img> auf share.svg), PNG-Download/-Kopie
             (Clipboard), SVG öffnen; URL-Sync ?share=today|week|month
             (+ ?sharehide=1); i18n de/en (identische Key-Mengen).
          c) E2E: tests/share.spec.ts (Content-Types, Hero-Zahl im SVG,
             Dialog via ?share=week, Download-Button).
          d) Verifikation: Summen der Range manuell gegen daily_agg;
             typecheck/build/E2E grün.
          e) NACHFORDERUNG Nutzer (Runde 4):
             - Projekt-Tri-State im Dialog: Include / Include (hide names) /
               Exclude (URL: ?shareproj=all|hide|none statt sharehide).
             - Exclude-Layout: ohne Projektsektion; die VIER Rekord-Badges
               als volle zweite Reihe unter der KPI-Zeile.
             - Bildsprache unabhängig von der UI-Sprache wählbar
               (?sharelang=de|en, Segmented-Control DE/EN im Dialog).
             - Range „today“: „Stärkster Tag“ entfällt (trivial) → stattdessen
               SCHLECHTESTE Cache-Hit-Rate unter Sessions mit > 10 Nachrichten.
             - Token-Split der Karte: Input (+ Cache Write) · Cached
               (Cache Read) · Output (Output + Reasoning zusammengefasst).
             - i18n symmetrisch; E2E (share-dialog.spec) an neue Params
               angepasst.

- [ ] 29. „Gesamt“-Auflösung + Chart-Sync am Token-Zeitverlauf (Nutzerwunsch):
          a) SERVER: fertig (bucketDay/validGranularity akzeptieren „all“ =
             ein Bucket über den ganzen Zeitraum; Granularity-Typ erweitert).
          b) FRONTEND: Auflösungs-Schalter um vierte Option „Gesamt“
             (i18n granAll de/en) erweitern; ?gran=all gültig (parseEnumParam-
             Allowlist). Tick-Formatter zeigt bei „all“ „Gesamt“ statt eines
             Datums. TokenShareChart nutzt dieselbe ?gran= wie der Trend-
             Chart (bisher hartkodiert „day“) — Kostenverlauf folgt bereits;
             damit sind alle Daten-Charts an die Auflösung gesynct.
          c) Drilldown-Guard: bei granularity==="all" dürfen Balken-/Area-
             Klicks KEIN ?day= setzen (Bucket hat kein reales Datum).
          d) CostTrendChart: bei „all“ Single-Point-Line sichtbar machen
             (dot an, sonst unsichtbar).
          e) E2E: Dashboard-Spec erweitern — Wechsel zu „Gesamt“ ⇒ genau
             1 Bucket, kein Crash, kein ?day=; i18n-Key-Mengen bleiben
             symmetrisch; alle bestehenden Suites bleiben grün.

## Verifikations-Log

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

## Archiv (frühere Todos, alle verifiziert & entfernt)
1.–2. Scaffold + pnpm-Setup · 3.–5. Pipeline · 6. Hono-API · 7. Frontend-Basis
· 8.–12. Vier Seiten inkl. Cache-Analyse · 13. Auto-Refresh · 14. Final Verify
· 15.–18. UI-Review-Findings · 19.–20. Volumen-Sicht/Anteils-Chart/Defaults
· 21. Balken-Chart · 22. Preis-Analyse · 23. URL-Filter
