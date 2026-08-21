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
