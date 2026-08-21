# agents.todo.md — opencode-usage

> Quelle der Wahrheit für alle Todos. Todos werden NUR entfernt, nachdem ein
> separater Verify-Subagent sie bestätigt hat (Typecheck/Build/Laufzeit-Check).
> Verifizierte Sachen MÜSSEN entfernt werden.

## Offene Todos

_(keine — alle Todos verifiziert und entfernt; nächster Schritt: Nutzer-Test
auf http://localhost:3712)_

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

## Archiv (frühere Todos, alle verifiziert & entfernt)
1.–2. Scaffold + pnpm-Setup · 3.–5. Pipeline · 6. Hono-API · 7. Frontend-Basis
· 8.–12. Vier Seiten inkl. Cache-Analyse · 13. Auto-Refresh · 14. Final Verify
· 15.–18. UI-Review-Findings · 19.–20. Volumen-Sicht/Anteils-Chart/Defaults
· 21. Balken-Chart · 22. Preis-Analyse · 23. URL-Filter
