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
        <!-- Captures + 5 Vision-Batches ERFOLGT (56 PNGs). Findings ->
             Todos 16-18. Re-Capture + Diff-Verify nach Fixes. -->

## UI-Review Findings (aus 5 Vision-Batches, konsolidiert)
- [ ] 16. CRITICAL/HIGH Chart-Fixes:
        a) Models: Donut-Charts (Anbieter/Familie) haben KEINE Legende ->
           Legende mit Farbboxen+Labels ergänzen (nutzlos ohne)
        b) Dashboard: Heatmap nutzt nur ~20% der Kartenbreite -> Grid auf
           Containerbreite strecken
        c) Models: Top-10-Kosten-Bar-Chart Labels geclippt (45° gedreht,
           abgeschnitten) -> horizontales Layout (Bar layout="vertical")
           bzw. Labels kürzen
        d) Sessions Scatterplot: YAxis domain [0,100] erzwingen
           (Regressionsgerade extrapoliert bis 179%!), Regressionspunkte
           auf 100 klemmen, Dot opacity 0.5 / r 3 gegen Overplotting,
           Regressionslinie bei |r|<0.5 grau/gestrichelt + strokeWidth 2.5
        e) Sessions Empty-State: Bucket-Chart rendert volle Achsen ohne
           Daten -> wie Dashboard-Charts leeren State zeigen
- [ ] 17. HIGH/MEDIUM Tabellen- & Layout-Fixes:
        a) Projects-Tabelle Mobile: 3. Spalte abgeschnitten -> overflow-x-auto
           Wrapper
        b) Sessions-Tabelle: Verzeichnis-Spalte zeigt volle Pfade -> nur
           Basename, voller Pfad im title-Attribut (~40% Breite sparen)
        c) Sessions-Titel: line-clamp-2 statt unbegrenzter Zeilen
        d) Projects: Orphan-Zeile ohne Name -> Fallback "(ohne Projekt)"
        e) Models Tabelle: Cache-Ratio 0% fast unsichtbar -> Badge statt
           Mini-Kreis; Familien-Slugs durch lesbare Namen aus models.dev-
           Metadaten ersetzen wo vorhanden
        f) KPI "Zeitraum" zeigt nur "--" -> Datumsbereich als Wert anzeigen
        g) i18n prüfen: Vision meldet Tippfehler "Durchscnittliche" ->
           tatsächlichen String in i18n.ts verifizieren und korrigieren
- [ ] 18. MEDIUM/LOW Mobile & Polish:
        a) Dashboard Mobile: Filter-Buttons kollidieren mit Kartentitel ->
           gestapelt (flex-col) auf Mobile
        b) Dashboard Mobile: KPI-Karten als grid-cols-2 statt gestapelt
        c) Charts Mobile: X-Achsen-Ticks reduzieren, Legende umbrechbar
        d) Empty-States: Kartenhöhe bei leeren Daten reduzieren (statt
           350-400px Leerraum), Text actionabler ("Starte opencode, um
           Token-Verbrauch zu erfassen")
        e) Untitled-Sessions mit ISO-Timestamp -> lokalisiert formatieren
        f) Footer: "Noch kein Datenstand · Fehler..." im filled-State war
           Meta-404-Bug (BEREITS GEFIXT, commit nach 3069694) -> via
           Re-Capture bestätigen, danach diesen Punkt entfernen
- [ ] 22. Preis-Analyse (Models-Seite, Nutzerwunsch): Tabelle je Modell mit
        Token-Mix (input/cache-read/output-%), Listenpreisen pro 1M Tokens
        (models.dev Snapshot, USD/token * 1M), EFFEKTIVEM Preis
        (= cost / alle Tokens, hervorgehoben) und optional theoretischem
        Preis (Mix × Listenpreis); Gesamtzeile: gewichteter Ø-Preis über
        alle Modelle = SUM(cost)/SUM(tokens) + Gesamt-Kosten/Tokens;
        Sortierung nach effektivem Preis desc; Gratis-Modelle = $0.00
        sichtbar; Plausibilitätstest: hy3 ~$0.27/1M, deepseek-v4-flash-free
        $0.00
- [ ] 19. Nutzer-Feedback: Volumen-Sicht für Modelle (hy3 fehlt):
        a) Models-Seite: ZWEI Top-10-Balkendiagramme als eigene Karten:
           "Top 10 nach Volumen" UND "Top 10 nach Kosten" (Nutzerwunsch:
           dupliziert statt Umschalter; Umschalter hier entfallen)
        b) Tabelle: Sortierung standardmäßig zusätzlich nach Volumen
           möglich (Sortier-Header existieren — prüfen, dass Volumen=
           input+output+reasoning als Sortierschlüssel vorhanden ist)
           -> ERGÄNZUNG (Nutzer): Modell-Aufschlüsselung bekommt Spalte
           "Total-Tokens" (input+output+reasoning, ohne cache) mit eigenem
           Sortier-Header; DEFAULT-Sortierung der Tabelle = Total-Tokens
           absteigend
        c) Donut-Charts sind bereits Volumen-basiert ("Token-Anteil"):
           prüfen, dass hy3 dort sichtbar ist (nicht in "Andere" versunken;
           ggf. Top-N erhöhen oder Legende zeigt "Andere"-Aufschlüsselung
           per Tooltip)
        d) Hintergrund: opencode-go/hy3 = 1,09 Mio Tokens (Rang 5 nach
           Volumen) aber nur $0.2954 -> fällt in Kosten-Sichten hinten raus
- [ ] 20. Nutzer-Feedback Runde 2:
        a) Cache-Analyse: minMessages-Threshold (default 20) ist serverseitig
           UMGESETZT (commit "feat(server): cache-analysis minMessages");
           Frontend: Hinweistext im Cache-Analyse-Kartel ("Sessions mit <20
           Nachrichten ausgeschlossen — Ratio stabilisiert sich erst nach
           Kontextaufbau"), ggf. Umschalter für Threshold
        b) NEUES Diagramm (Dashboard): Tagesverlauf der Token-Anteile als
           100%-gestapeltes AreaChart (input / cache_read / output /
           reasoning, normalisiert auf je Tag) — Daten sind bereits über
           getTimeseries(groupBy="total") verfügbar, Normalisierung client-
           side
        c) Defaults auf VOLUMEN statt Kosten umstellen: Models Top-Chart
           (mit Todo 19a-Umschalter, Default Volumen), Projects Balken-
           diagramm, Sessions-Tabellen-Sortierung
- [ ] 21. Nutzer-Feedback Runde 3: Dashboard Token-Zeitverlauf — Chart-Typ
        folgt Granularity: Tag = gestapelte AreaChart (wie bisher),
        Woche/Monat = gestapeltes BarChart (stackId="tokens", eine Bar-Serie
        je Token-Kategorie). Begründung: diskrete Buckets, bessere
        Vergleichbarkeit, unvollständige aktuelle Woche sichtbar. Kosten-
        verlauf analog prüfen (Line ok für alle Granularitäten, da einzelner
        Trend-Wert)

## Final
- [ ] 14. Final verify: typecheck, vite build, pnpm start E2E gegen echte DB
        (API liefert echte Zahlen, Seiten rendern)
