# opencode-usage

Lokales Dashboard für deinen [OpenCode](https://opencode.ai)-Token- und
Kostenverbrauch – eine Single-User-Version von
[opencode.ai/de/data](https://opencode.ai/de/data/), komplett offline auf
deiner Maschine.

![Stack](https://img.shields.io/badge/React%2019-React%20Compiler-blue)
![Stack](https://img.shields.io/badge/Vite%208-TypeScript%20strict-blue)
![Stack](https://img.shields.io/badge/Tailwind%204-daisyUI%205-green)

## Was zeigt das Dashboard?

| Seite | Inhalt |
|---|---|
| **Dashboard** | KPI-Karten (Tokens, Kosten, Sessions, Nachrichten, Cache-Hit-Ratio, Zeitraum), Token-Zeitverlauf gestapelt (Tag/Woche/Monat × Anbieter/Familie/Gesamt), **Token-Anteile pro Tag** (input/cache/output/reasoning als 100 %-Fläche), Kostenverlauf, Aktivitäts-Heatmap (Woche × Stunde) |
| **Modelle** | Breakdown nach Anbieter & Modellfamilie (Volumen **und** Kosten umschaltbar), Donut-Charts mit Legende, Top-10-Balkendiagramm, Tabelle mit Kontextfenster & Cache-Ratio – angereichert mit Metadaten von [models.dev](https://models.dev) (`@opencode-ai/models`, offline via Snapshot) |
| **Projekte** | Token-Volumen & Kosten pro Projekt/Verzeichnis, Balkendiagramm + Tabelle |
| **Sessions** | Alle Sessions mit Sortierung/Filter/Pagination, Session-Detail (Token-Breakdown, Cache-Ratio), und die **Cache-Analyse**: Scatterplot Nachrichtenanzahl ↔ Cache-Hit-Ratio mit Regressionsgerade, Pearson-Korrelation und Bucket-Durchschnitten |

### Die Cache-Analyse

Die Kernfrage des Projekts: *Gehen mehr Nachrichten pro Session mit einer
besseren Cache-Nutzung einher?* — **Ja.** Die durchschnittliche
Cache-Hit-Ratio steigt monoton mit der Sitzungslänge (von ~50 % bei 1–5
Nachrichten auf ~97 % bei 101+). Sessions mit weniger als 20 Nachrichten sind
standardmäßig ausgeblendet, da sich die Ratio erst nach dem Kontextaufbau
stabilisiert (Threshold per URL-Parameter `?minMessages=` konfigurierbar).

## Architektur

```
~/.local/share/opencode/opencode.db        OpenCode SQLite (v2-Schema,
        │  read-only                       Tabelle session_message)
        ▼
scripts/extract.ts ──────────────► data/stats.db          Analyse-DB
scripts/watch.ts  (mtime-Polling)   (better-sqlite3, WAL) Aggregat-Tabellen:
        │                                   messages, sessions_agg,
        │                                   daily_agg, hourly_agg,
        │                                   project_agg, meta
        ▼
server/index.ts (Hono, Port 3712) ──► /api/stats/*  JSON-API
        │       └──────────────────► statisches Frontend (dist/)
        ▼
React SPA (Vite build) — React Router, Recharts, daisyUI 5
```

- **Datenpipeline:** `session_message` (v2-Schema, `type='assistant'` mit
  `tokens`) wird flach entpackt und inkrementell in eigene Aggregate
  überführt. Die Quell-DB wird **strikt read-only** geöffnet.
- **Auto-Refresh:** Der Watcher erkennt DB-Änderungen (2-s-mtime-Polling),
  der Extractor sync't inkrementell (~ms), das Frontend pollt alle 60 s.
- **Kein Cloud-Bezug:** Alles bleibt lokal auf deiner Maschine.

## Setup

```bash
pnpm install

# Daten einmalig synchronisieren (oder --full für Komplett-Rebuild)
pnpm sync

# Server starten (API + Frontend auf einem Port)
pnpm start
# → http://localhost:3712
```

Für Entwicklung mit Hot Reload:

```bash
pnpm watch   # Extractor im Watch-Modus (Terminal 1)
pnpm start   # API auf :3712 (Terminal 2)
pnpm dev     # Vite Dev-Server auf :5173, proxied /api → :3712 (Terminal 3)
```

## Befehle

| Befehl | Zweck |
|---|---|
| `pnpm sync [--full]` | Extractor: inkrementeller bzw. kompletter Sync |
| `pnpm watch` | Extractor-Watcher (auto-sync bei DB-Änderung) |
| `pnpm start` | Hono-API + statisches Frontend (Port 3712, `PORT`/`STATS_DB` per ENV) |
| `pnpm dev` | Vite-Dev-Server |
| `pnpm build` | Typecheck + Produktionsbuild nach `dist/` |
| `pnpm typecheck` | Nur Typecheck |
| `pnpm test:screenshots` | UI-Review-Screenshots (Playwright, siehe `tests/screenshots/`) |

## Datenschema & Datenschutz

- Gelesen wird ausschließlich `~/.local/share/opencode/opencode.db`
  (**read-only**, `readonly: true` – better-sqlite3 v13 unterstützt den
  `file:?mode=ro`-URI hier nicht).
- Geschrieben wird nur in die eigene Analyse-DB `data/stats.db` (gitignored).
- Das Schema der Analyse-DB ist in [`docs/stats-db-schema.md`](docs/stats-db-schema.md)
  dokumentiert.
- Es werden keine Daten verlassen den Rechner – keine Telemetrie, keine
  externen Calls zur Laufzeit (models.dev-Metadaten kommen aus dem
  npm-Snapshot).

## Tech-Stack

- **Frontend:** React 19 + React Compiler, React Router, Recharts 3,
  Tailwind CSS 4 + daisyUI 5 (Theme folgt dem System), eigenes schlankes
  i18n (de/en, `{placeholder}`-Interpolation – Muster wie
  [ocgo-price-tracker](https://github.com/…))
- **Server:** Hono + @hono/node-server
- **Pipeline:** better-sqlite3, TypeScript strict, tsx
- **Qualität:** Playwright-Screenshot-Harness + Vision-Agent-Review
  (ui-review-Skill), unabhängige Verify-Agents gegen die Quell-DB

## Projekt-Workflow

Dieses Projekt wird agenten-getrieben entwickelt: `agents.todo.md` ist die
Todo-Quelle der Wahrheit. Todos werden nur entfernt, wenn ein separater
Verify-Agent sie bestätigt hat (Typecheck/Build/Laufzeit-Gegenprobe gegen die
Quell-DB). Konventionen stehen in [`AGENTS.md`](AGENTS.md).
