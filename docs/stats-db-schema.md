# Analyse-DB Schema (`data/stats.db`)

Gebaut von `scripts/extract.ts` (better-sqlite3). Quelle:
`~/.local/share/opencode/opencode.db` — IMMER strikt read-only öffnen:
`new Database(src, { fileMustExist: true, readonly: true })` (der
`file:?mode=ro`-URI funktioniert mit better-sqlite3 v13 nicht).

## Tabellen

```sql
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,      -- epoch ms (aus data.time.created)
  provider_id TEXT NOT NULL,          -- data.providerID
  model_id TEXT NOT NULL,             -- data.modelID
  cost REAL NOT NULL DEFAULT 0,       -- data.cost
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,   -- data.tokens.cache.read
  cache_write INTEGER NOT NULL DEFAULT 0   -- data.tokens.cache.write
);
CREATE INDEX IF NOT EXISTS messages_time_idx ON messages(time_created);
CREATE INDEX IF NOT EXISTS messages_provider_model_idx ON messages(provider_id, model_id);

CREATE TABLE IF NOT EXISTS sessions_agg (
  session_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  directory TEXT NOT NULL,
  title TEXT,
  model TEXT,                          -- session_v2.model
  agent TEXT,                          -- session_v2.agent
  msg_count INTEGER NOT NULL DEFAULT 0,     -- nur assistant-messages mit token-Daten
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_agg (
  day TEXT NOT NULL,                   -- YYYY-MM-DD (lokale Zeit)
  directory TEXT NOT NULL,             -- session_v2.directory je message; Orphans => ""
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, directory, provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS hourly_agg (
  day TEXT NOT NULL,                   -- YYYY-MM-DD lokal
  hour INTEGER NOT NULL,               -- 0-23 lokal
  directory TEXT NOT NULL,             -- session_v2.directory je message; Orphans => ""
  msg_count INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, directory)
);

CREATE TABLE IF NOT EXISTS project_agg (
  project_id TEXT PRIMARY KEY,
  directory TEXT NOT NULL,
  name TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  msg_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  last_activity_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- meta keys: last_sync (epoch ms), source_db (pfad),
--            source_pruned_until (cutoff, epoch ms), source_pruned_at (epoch ms),
--            source_pruned_count (kumulativ gelöschte Zeilen),
--            source_retention_months (Retention zum letzten Prune)
```

## Extraktionsregeln

Quelle ist ausschließlich die v2-Tabelle `session_message` (FK → `session_v2`).
Die alte `message`-Tabelle wurde vollständig nach `session_message` migriert und
ist NICHT mehr Teil des Daten-Scopes (die wenigen nur dort verbliebenen IDs sind
Migrations-Artefakte eines noch offenen alten Clients und werden ignoriert).

- Nur `session_message` mit `type = 'assistant'` UND vorhandenem `tokens`-Objekt
  (`json_extract(data, '$.tokens') IS NOT NULL`).
- Feld-Mapping aus `data`:
  - `provider_id` = `data.model.providerID` (verschachtelt, NICHT mehr flat `data.providerID`)
  - `model_id`    = `data.model.id` (verschachtelt, NICHT mehr flat `data.modelID`)
  - `cost`        = `data.cost` (top-level, Zahl)
  - `tokens_*`    = `data.tokens.input/output/reasoning`, `cache.read`/`cache.write` (wie zuvor)
- `time_created` = Spalte `session_message.time_created` (epoch ms, eigene Spalte —
  nicht mehr `data.time.created` ausgraben).
- Inkrementell: nur rows mit `time_created >= last_sync` verarbeiten; betroffene
  sessions/days/projects neu aggregieren (DELETE + INSERT der betroffenen
  Aggregat-Zeilen aus messages-Tabelle). `INSERT OR REPLACE` auf `message_id`
  hält die Extraktion idempotent.
- Cache-Hit-Ratio wird NICHT gespeichert, sondern in Queries berechnet:
  `cache_read / NULLIF(input_tokens + cache_read + cache_write, 0)`.
- Session-Felder (project_id, directory, title, model, agent) kommen aus
  `session_v2` via `session_id → session_v2.id`. Fehlende Session referenzieren
  (orphans): in `sessions_agg` überspringen.
- `directory` in `daily_agg`/`hourly_agg` = `session_v2.directory` der jeweiligen
  Message (via `session_id`). Messages ohne Session (Orphans) erhalten
  `directory = ''` (leerer String, damit sie in der globalen Summe bleiben).

### Historisch (legacy `message`, nicht mehr genutzt)

Vor der Migration las der Extractor aus der Tabelle `message`:
`role = 'assistant'` + `tokens`, `provider_id = data.providerID`,
`model_id = data.modelID` (flat), `time_created = data.time.created`.
Diese Felder existieren im v2-Format nicht mehr (jetzt verschachtelt unter
`data.model`).

## Retention (Quell-DB kürzen)

`scripts/prune-source.ts` (`pnpm prune-source` — `pnpm prune` ist das eingebaute
pnpm-Kommando und wird NICHT unser Script; Automatik in `pnpm watch`) löscht alte
`session_message`-Zeilen aus der QUELL-DB, sobald stats.db sie vollständig
übernommen hat. Invariante: stats.db ist eine Obermenge des Löschbereichs;
die Reihenfolge ist immer sync → Preflight → Backup → löschen. Es ist die
EINZIGE Stelle im Projekt, die je an die Quell-DB schreibt (für den DELETE mit
Lese-Schreib-Zugriff; sonst überall strikt read-only).

- **Cutoff / Retention**: in Kalendermonaten konfigurierbar, Default **2 Monate**.
  Cutoff = lokaler 1. des Monats, (retention − 1) Monate zurück — bei Default 2
  also der 1. des VORMONATS (alles davor wird gelöscht; im September werden
  Juli und älter gelöscht, August bleibt); 1 ⇒ 1. des aktuellen Monats.
  Vorrang: `--cutoff YYYY-MM-DD` / `--days N` > `--months N` >
  Env `PRUNE_RETENTION_MONTHS` > Default 2.
- **Umfang**: nur `session_message`-Zeilen (`DELETE … WHERE time_created <
  cutoff` in einer Transaktion + `wal_checkpoint(TRUNCATE)`). `session_v2`
  (Sessions) bleibt unberührt (Session-Pruning = V2).
- **Dry-Run-Default**: ohne `--yes` wird nur gemeldet (Anzahl, Zeitraum,
  `SUM(LENGTH(data))`-Größe, älteste verbleibende Message, Vorab-Preflight) —
  nichts geschrieben, kein Backup, keine meta-Änderung.
- **Preflight**: für `time_created < cutoff` müssen Quelle und stats.db
  deckungsgleich sein (COUNT + Token-/Kosten-Summen, Filter exakt wie im
  Extractor: `type='assistant'` UND `$.tokens` vorhanden). stats.db muss ≥
  Quelle sein, sonst Abbruch ohne jede Änderung.
- **Backup**: vor dem Löschen `VACUUM INTO` von einer read-only Connection nach
  `~/.local/share/opencode/opencode-backup-YYYYMMDD.db` (rotierend: vorhandene
  `opencode-backup-*.db` werden ersetzt). Fehlschlag ⇒ Abbruch, nichts gelöscht.
- **VACUUM der Quelle** nur manuell (`pnpm prune-source --yes --vacuum` — OpenCode muss
  dafür geschlossen sein); im Automatik-Pfad nie aktiv. Ohne VACUUM wird der
  Platz erst beim Datei-Wachstum wiederverwendet (freie Pages bleiben in der DB).
- **meta-Keys** (stats.db): `source_pruned_until` (Cutoff, epoch ms),
  `source_pruned_at` (letzter Lauf), `source_pruned_count` (kumulativ
  gelöschte Zeilen), `source_retention_months` (Retention zum Laufzeitpunkt).
- **`--full`-Guard** (extract.ts): ist `source_pruned_until` gesetzt, verweigert
  `sync({ full: true })` ohne `force`/`--force` — ein Full-Rebuild würde die
  gelöschte History aus stats.db entfernen. Hinweis auf Backup-Dateien in der
  Fehlermeldung; `--force` überschreibt bewusst. Inkrementelle Syncs sind nie
  betroffen.
- **Watch-Automatik**: nach jedem erfolgreichen Sync `maybePrune()` — COUNT=0-
  Vorcheck auf der Quelle, bei >0 Prune mit `--yes`-Äquivalent; höchstens ein
  erfolgreicher Lauf pro Tag, Fehler killen den Loop nie.
