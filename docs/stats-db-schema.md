# Analyse-DB Schema (`data/stats.db`)

Gebaut von `scripts/extract.ts` (better-sqlite3). Quelle:
`~/.local/share/opencode/opencode.db` — IMMER read-only öffnen:
`new Database("file:" + src + "?mode=ro", { fileMustExist: true })`.

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
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS hourly_agg (
  day TEXT NOT NULL,                   -- YYYY-MM-DD lokal
  hour INTEGER NOT NULL,               -- 0-23 lokal
  msg_count INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour)
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
-- meta keys: last_sync (epoch ms ISO), source_db (pfad)
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

### Historisch (legacy `message`, nicht mehr genutzt)

Vor der Migration las der Extractor aus der Tabelle `message`:
`role = 'assistant'` + `tokens`, `provider_id = data.providerID`,
`model_id = data.modelID` (flat), `time_created = data.time.created`.
Diese Felder existieren im v2-Format nicht mehr (jetzt verschachtelt unter
`data.model`).
