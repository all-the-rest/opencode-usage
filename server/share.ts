/**
 * Share-Card: Token-Statistik als Social-Media-Bild (Todo 28/28e).
 *
 * Aggregation (getShareData) + reiner SVG-String-Renderer
 * (renderShareCard) + PNG-Konvertierung (renderSharePng). Bewusst ohne
 * Import aus src/ — Zahlenformatierung hier dupliziert, um die i18n-
 * Kopplung des Frontends nicht auf den Server zu ziehen.
 *
 * Range-Fenster als YYYY-MM-DD-Tagesstrings in LOCALTIME (daily_agg.day
 * wird vom Extractor localtime-basiert gefüllt); lexikographischer
 * Vergleich genügt. Woche = ISO-Woche (Montag..Sonntag).
 *
 * Todo 28e: Projekt-Tri-State `projects=all|hide|none` ("none" = Exclude-
 * Layout ohne Projektsektion), Rekorde je Range (today → worstCache,
 * week/month → strongestDay) und Card-Split Input(+Cache Write) · Cached
 * · Output(+Reasoning).
 */
import { Resvg } from "@resvg/resvg-js";
import type { DatabaseType } from "./db";
import { cacheHitRatio, num } from "./db";

export type ShareRange =
  | "today"
  | "yesterday"
  | "week"
  | "lastweek"
  | "month"
  | "lastmonth";
export type ShareLang = "de" | "en";
/**
 * Tri-State für die Projektsektion:
 * - "all": Top-5-Projekte mit echten Basenames.
 * - "hide": Top-5-Projekte anonymisiert als „Projekt 1..n“.
 * - "none": Projekte bewusst ausgeschlossen (keine Query, Exclude-Layout).
 */
export type ShareProjectsMode = "all" | "hide" | "none";

export interface ShareProject {
  name: string;
  tokens: number;
}

export interface ShareRecord {
  /** Anzeigetitel (Session-Titel bzw. Tag), null wenn kein Rekord vorliegt. */
  title: string | null;
  /** Formatierter Wert (z. B. "3h 12m", "1.2M", "97.3%"). */
  value: string;
}

export interface ShareData {
  range: ShareRange;
  lang: ShareLang;
  periodLabel: string;
  periodDetail: string;
  project: string | null;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  msgCount: number;
  sessionCount: number;
  cacheHitRatio: number;
  /** Cache-Write-Tokens — im Card-Split dem Input zugerechnet. */
  cacheWriteTokens: number;
  /** Cache-Read-Tokens — eigener Anteil im Card-Split („Cached“). */
  cacheReadTokens: number;
  topProjects: ShareProject[];
  records: {
    longestSession: ShareRecord | null;
    biggestSession: ShareRecord | null;
    bestCache: ShareRecord | null;
    /** Nur für week/month (bei „today“ wäre „bester Tag“ trivial). */
    strongestDay: ShareRecord | null;
    /** Nur für today: schlechteste Cache-Hit-Rate (Sessions > 10 Nachrichten). */
    worstCache: ShareRecord | null;
  };
}

/** Lokales Datum als YYYY-MM-DD. */
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Montag der ISO-Woche (localtime). */
function mondayOf(d: Date): Date {
  const c = new Date(d);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
}

export function resolveRangeWindow(
  range: ShareRange,
  now = new Date(),
): { start: string; end: string } {
  if (range === "today") {
    const day = ymdLocal(now);
    return { start: day, end: day };
  }
  if (range === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const day = ymdLocal(yesterday);
    return { start: day, end: day };
  }
  if (range === "week") {
    const mon = mondayOf(now);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { start: ymdLocal(mon), end: ymdLocal(sun) };
  }
  if (range === "lastweek") {
    const mon = new Date(mondayOf(now));
    mon.setDate(mon.getDate() - 7);
    const sun = new Date(mon);
    sun.setDate(sun.getDate() + 6);
    return { start: ymdLocal(mon), end: ymdLocal(sun) };
  }
  if (range === "month") {
    // month: erster bis letzter Tag des aktuellen Monats
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: ymdLocal(first), end: ymdLocal(last) };
  }
  // lastmonth: erster bis letzter Tag des Vormonats
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: ymdLocal(first), end: ymdLocal(last) };
}

// --- Kompakte Zahlenformate (Duplikat aus src/lib/format.ts, siehe oben) ---

function trimNum(x: number): string {
  return x
    .toFixed(2)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e9) return trimNum(n / 1e9) + "B";
  if (abs >= 1e6) return trimNum(n / 1e6) + "M";
  if (abs >= 1e3) return trimNum(n / 1e3) + "K";
  return String(Math.round(n));
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return "$" + n.toFixed(2);
}

function fmtRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return "0%";
  return (ratio * 100).toFixed(1) + "%";
}

function fmtDuration(ms: number, lang: ShareLang): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return lang === "de" ? `${min} min` : `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function fmtDay(day: string, lang: ShareLang): string {
  const d = new Date(`${day}T00:00:00`);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-US", {
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}

const LABELS = {
  de: {
    tokens: "Tokens",
    splitIn: "Input (+ Cache Write)",
    splitCached: "Cached",
    splitOut: "Output",
    cost: "Kosten",
    messages: "Nachrichten",
    sessions: "Sessions",
    cacheHit: "Cache-Hit",
    projects: "Top-Projekte",
    recLongest: "Längste Session",
    recBiggest: "Größte Session",
    recBestCache: "Beste Cache-Hit-Rate",
    recStrongestDay: "Stärkster Tag",
    recWorstCache: "Schlechteste Cache-Hit-Rate",
    noData: "—",
    periodToday: "Heute",
    periodYesterday: "Gestern",
    periodWeek: "Diese Woche",
    periodLastWeek: "Letzte Woche",
    periodMonth: "Dieser Monat",
    periodLastMonth: "Letzter Monat",
    projectN: (i: number) => `Projekt ${i}`,
  },
  en: {
    tokens: "tokens",
    splitIn: "Input (+ cache write)",
    splitCached: "Cached",
    splitOut: "Output",
    cost: "Cost",
    messages: "Messages",
    sessions: "Sessions",
    cacheHit: "Cache hit",
    projects: "Top projects",
    recLongest: "Longest session",
    recBiggest: "Biggest session",
    recBestCache: "Best cache-hit rate",
    recStrongestDay: "Strongest day",
    recWorstCache: "Worst cache-hit rate",
    noData: "—",
    periodToday: "Today",
    periodYesterday: "Yesterday",
    periodWeek: "This week",
    periodLastWeek: "Last week",
    periodMonth: "This month",
    periodLastMonth: "Last month",
    projectN: (i: number) => `Project ${i}`,
  },
} as const;

/** Projekt-Filter identisch zu projectFilter() in server/index.ts. */
function projectSql(project: string | undefined): { sql: string; params: string[] } {
  const d = project?.trim();
  if (!d) return { sql: "", params: [] };
  return {
    sql: " AND (directory = ? OR directory LIKE '%/' || ?)",
    params: [d, d],
  };
}

export function getShareData(
  db: DatabaseType,
  opts: {
    range: ShareRange;
    project?: string;
    /** Tri-State statt hideProjects (Todo 28e). Default "all". */
    projects?: ShareProjectsMode;
    lang?: ShareLang;
  },
): ShareData {
  const lang: ShareLang = opts.lang ?? "de";
  const projectsMode: ShareProjectsMode = opts.projects ?? "all";
  const L = LABELS[lang];
  const { start, end } = resolveRangeWindow(opts.range);

  // --- KPIs über daily_agg im Fenster (directory steckt direkt in daily_agg) ---
  const pj = projectSql(opts.project);
  const kpiRow = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
              COALESCE(SUM(cache_read), 0) AS cacheRead,
              COALESCE(SUM(cache_write), 0) AS cacheWrite,
              COALESCE(SUM(cost), 0) AS cost,
              COALESCE(SUM(msg_count), 0) AS msgCount
       FROM daily_agg
       WHERE day BETWEEN ? AND ?${pj.sql}`,
    )
    .get(start, end, ...pj.params) as
    | {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheRead: number;
        cacheWrite: number;
        cost: number;
        msgCount: number;
      }
    | undefined;

  // Sessions im Fenster separat (daily_agg hat keine session_id).
  const sessWhereBase = `WHERE date(time_updated / 1000, 'unixepoch', 'localtime') BETWEEN ? AND ?${projectSql(opts.project).sql}`;
  const sessBaseParams = [start, end, ...projectSql(opts.project).params];
  const sessionCount = num(
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM sessions_agg ${sessWhereBase}`)
        .get(...sessBaseParams) as { c: number } | undefined
    )?.c,
  );

  const inputTokens = num(kpiRow?.inputTokens);
  const outputTokens = num(kpiRow?.outputTokens);
  const reasoningTokens = num(kpiRow?.reasoningTokens);
  // Menschliche Entscheidung (2026-08-21): Token-Totale inkl. Cache Read.
  const totalTokens =
    inputTokens + outputTokens + reasoningTokens + num(kpiRow?.cacheRead);

  // --- Top-Projekte im Fenster (nur bei projects !== "none") ---
  let topProjects: ShareProject[] = [];
  if (projectsMode !== "none") {
    const projRows = db
      .prepare(
        `SELECT directory,
                SUM(input_tokens + output_tokens + reasoning_tokens + cache_read) AS tokens
         FROM daily_agg
         WHERE day BETWEEN ? AND ?${pj.sql}
         GROUP BY directory
         ORDER BY tokens DESC
         LIMIT 5`,
      )
      .all(start, end, ...pj.params) as Array<{ directory: string; tokens: number }>;

    topProjects = projRows.map((r, i) => ({
      name:
        projectsMode === "hide"
          ? L.projectN(i + 1)
          : (r.directory.split("/").filter(Boolean).pop() ?? r.directory),
      tokens: num(r.tokens),
    }));
  }

  // --- Rekorde aus sessions_agg (im Fenster aktiv) ---
  const sessWhere = sessWhereBase;
  const sessParams = sessBaseParams;

  const longest = db
    .prepare(
      `SELECT title, time_updated - time_created AS durMs
       FROM sessions_agg ${sessWhere}
       ORDER BY durMs DESC LIMIT 1`,
    )
    .get(...sessParams) as { title: string | null; durMs: number } | undefined;

  const biggest = db
    .prepare(
      `SELECT title, input_tokens + output_tokens + reasoning_tokens AS tokens
       FROM sessions_agg ${sessWhere}
       ORDER BY tokens DESC LIMIT 1`,
    )
    .get(...sessParams) as { title: string | null; tokens: number } | undefined;

  const bestCache = db
    .prepare(
      `SELECT title,
              CAST(cache_read AS REAL) /
                NULLIF(input_tokens + cache_read + cache_write, 0) AS ratio
       FROM sessions_agg ${sessWhere}
         AND msg_count >= 20
         AND input_tokens + cache_read + cache_write > 0
       ORDER BY ratio DESC LIMIT 1`,
    )
    .get(...sessParams) as { title: string | null; ratio: number } | undefined;

  // Stärkster Tag nur für Mehr-Tages-Ranges (week/lastweek/month/lastmonth) —
  // bei Einzel-Tages-Ranges (today/yesterday) trivial (Todo 28e).
  const isSingleDay = opts.range === "today" || opts.range === "yesterday";
  const strongestDay = isSingleDay
    ? undefined
    : (db
        .prepare(
          `SELECT day, SUM(input_tokens + output_tokens + reasoning_tokens + cache_read) AS tokens
           FROM daily_agg
           WHERE day BETWEEN ? AND ?${pj.sql}
           GROUP BY day ORDER BY tokens DESC LIMIT 1`,
        )
        .get(start, end, ...pj.params) as
      | { day: string; tokens: number }
      | undefined);

  // Schlechteste Cache-Hit-Rate nur für Einzel-Tages-Ranges (today/yesterday):
  // Sessions mit > 10 Nachrichten und positivem Nenner (input+cache_read+cache_write).
  const worstCache =
    !isSingleDay
      ? undefined
      : (db
          .prepare(
            `SELECT title,
                    CAST(cache_read AS REAL) /
                      NULLIF(input_tokens + cache_read + cache_write, 0) AS ratio
             FROM sessions_agg ${sessWhere}
               AND msg_count > 10
               AND input_tokens + cache_read + cache_write > 0
             ORDER BY ratio ASC LIMIT 1`,
          )
          .get(...sessParams) as { title: string | null; ratio: number } | undefined);

  const shortTitle = (t: string | null | undefined): string | null => {
    if (!t) return null;
    return t.length > 34 ? t.slice(0, 33) + "…" : t;
  };

  const records: ShareData["records"] = {
    longestSession: longest
      ? {
          title: shortTitle(longest.title),
          value: fmtDuration(num(longest.durMs), lang),
        }
      : null,
    biggestSession: biggest
      ? { title: shortTitle(biggest.title), value: fmtTokens(num(biggest.tokens)) }
      : null,
    bestCache:
      bestCache && typeof bestCache.ratio === "number"
        ? {
            title: shortTitle(bestCache.title),
            value: fmtRatio(bestCache.ratio),
          }
        : null,
    strongestDay: strongestDay
      ? {
          title: fmtDay(strongestDay.day, lang),
          value: fmtTokens(num(strongestDay.tokens)),
        }
      : null,
    worstCache:
      worstCache && typeof worstCache.ratio === "number"
        ? {
            title: shortTitle(worstCache.title),
            value: fmtRatio(worstCache.ratio),
          }
        : null,
  };

  // --- Perioden-Label ---
  const locale = lang === "de" ? "de-DE" : "en-US";
  const fmtDate = (day: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(`${day}T00:00:00`),
    );
  let periodLabel: string;
  let periodDetail: string;
  if (opts.range === "today" || opts.range === "yesterday") {
    periodLabel = opts.range === "today" ? L.periodToday : L.periodYesterday;
    periodDetail = fmtDate(start);
  } else if (opts.range === "week" || opts.range === "lastweek") {
    periodLabel = opts.range === "week" ? L.periodWeek : L.periodLastWeek;
    periodDetail =
      lang === "de"
        ? `${fmtDate(start)} – ${fmtDate(end)}`
        : `${fmtDate(start)} – ${fmtDate(end)}`;
  } else {
    periodLabel = opts.range === "month" ? L.periodMonth : L.periodLastMonth;
    const monthDate =
      opts.range === "month" ? new Date() : new Date(`${start}T00:00:00`);
    periodDetail = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
    }).format(monthDate);
  }

  return {
    range: opts.range,
    lang,
    periodLabel,
    periodDetail,
    project: opts.project?.trim() || null,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cost: num(kpiRow?.cost),
    msgCount: num(kpiRow?.msgCount),
    sessionCount,
    cacheHitRatio: cacheHitRatio(
      inputTokens,
      num(kpiRow?.cacheRead),
      num(kpiRow?.cacheWrite),
    ),
    cacheWriteTokens: num(kpiRow?.cacheWrite),
    cacheReadTokens: num(kpiRow?.cacheRead),
    topProjects,
    records,
  };
}

// --- SVG-Renderer ---

const W = 1200;
const H = 630;
const ACCENT = "#422ad5";
const BG = "#17151f";

/** XML-Escaping für alle dynamischen Texte. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderShareCard(data: ShareData): string {
  const L = LABELS[data.lang];

  // Exclude-Layout (keine Projekte): Rekord-Badges als volle zweite Reihe.
  const exclude = data.topProjects.length === 0;

  // Balken-Skalierung am stärksten Projekt ausrichten
  const maxProj = Math.max(1, ...data.topProjects.map((p) => p.tokens));

  const kpiCells: Array<[string, string]> = [
    [L.cost, fmtCost(data.cost)],
    [L.messages, fmtTokens(data.msgCount)],
    [L.sessions, String(data.sessionCount)],
    [L.cacheHit, fmtRatio(data.cacheHitRatio)],
  ];

  // 4. Rekord-Badge: Einzel-Tag (today/yesterday) → schlechteste Cache-Hit-Rate,
  // week/lastweek/month/lastmonth → stärkster Tag (Todo 28e).
  const singleDay = data.range === "today" || data.range === "yesterday";
  const fourth = singleDay
    ? { label: L.recWorstCache, rec: data.records.worstCache }
    : { label: L.recStrongestDay, rec: data.records.strongestDay };

  const recordEntries: Array<[string, ShareRecord | null]> = [
    [L.recLongest, data.records.longestSession],
    [L.recBiggest, data.records.biggestSession],
    [L.recBestCache, data.records.bestCache],
    [fourth.label, fourth.rec],
  ];

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
  );
  parts.push(`<defs>
    <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);
  parts.push(`<rect width="${W}" height="8" fill="url(#accentBar)"/>`);

  // Header
  parts.push(
    `<circle cx="64" cy="66" r="12" fill="${ACCENT}"/>`,
    `<text x="88" y="73" font-size="26" font-weight="700" fill="#ffffff">OpenCode Usage</text>`,
    `<text x="${W - 64}" y="73" font-size="24" font-weight="600" fill="#b9b3d0" text-anchor="end">${esc(data.periodLabel)} · ${esc(data.periodDetail)}</text>`,
  );

  // Projekt-Badge
  let y = 130;
  if (data.project) {
    parts.push(
      `<rect x="64" y="${y - 24}" rx="14" width="${Math.min(420, 40 + data.project.length * 11)}" height="32" fill="${ACCENT}" opacity="0.35"/>`,
      `<text x="84" y="${y - 2}" font-size="18" fill="#cdc7ea">📁 ${esc(data.project)}</text>`,
    );
    y += 46;
  }

  // Hero — Split-Semantik (Todo 28e):
  // Input = input + cache_write · Cached = cache_read · Output = output + reasoning
  const shift = exclude ? 52 : 0; // Exclude-Layout: Block leicht nach unten
  const heroBase = y + 64 + shift;
  const heroSub = y + 98 + shift;
  const inputShare = data.inputTokens + data.cacheWriteTokens;
  const outputShare = data.outputTokens + data.reasoningTokens;
  parts.push(
    `<text x="64" y="${heroBase}" font-size="76" font-weight="800" fill="#ffffff">${esc(fmtTokens(data.totalTokens))}</text>`,
    `<text x="64" y="${heroSub}" font-size="24" fill="#9a93b5">${esc(L.tokens)}</text>`,
    `<text x="${W - 64}" y="${heroBase}" font-size="21" fill="#9a93b5" text-anchor="end">${esc(L.splitIn)} ${esc(fmtTokens(inputShare))} · ${esc(L.splitCached)} ${esc(fmtTokens(data.cacheReadTokens))} · ${esc(L.splitOut)} ${esc(fmtTokens(outputShare))}</text>`,
  );

  // KPI-Zeile (4 Zellen)
  const kpiY = y + 128 + shift;
  const cellW = (W - 128) / 4;
  kpiCells.forEach(([label, value], i) => {
    const x = 64 + i * cellW;
    parts.push(
      `<rect x="${x}" y="${kpiY}" width="${cellW - 16}" height="86" rx="12" fill="#211d2e"/>`,
      `<text x="${x + 18}" y="${kpiY + 36}" font-size="17" fill="#9a93b5">${esc(label)}</text>`,
      `<text x="${x + 18}" y="${kpiY + 68}" font-size="27" font-weight="700" fill="#ffffff">${esc(value)}</text>`,
    );
  });

  if (!exclude) {
    // Top-Projekte (links, max 5 Zeilen)
    const projY = kpiY + 122;
    parts.push(
      `<text x="64" y="${projY}" font-size="19" font-weight="600" fill="#cdc7ea">${esc(L.projects)}</text>`,
    );
    const barMaxW = 300;
    data.topProjects.slice(0, 5).forEach((p, i) => {
      const rowY = projY + 22 + i * 32;
      const w = Math.max(4, Math.round((p.tokens / maxProj) * barMaxW));
      parts.push(
        `<text x="64" y="${rowY + 15}" font-size="15" fill="#e6e2f5">${esc(p.name.length > 30 ? p.name.slice(0, 29) + "…" : p.name)}</text>`,
        `<rect x="330" y="${rowY + 2}" width="${barMaxW}" height="16" rx="8" fill="#211d2e"/>`,
        `<rect x="330" y="${rowY + 2}" width="${w}" height="16" rx="8" fill="url(#accentBar)"/>`,
        `<text x="${330 + barMaxW + 14}" y="${rowY + 15}" font-size="15" fill="#9a93b5">${esc(fmtTokens(p.tokens))}</text>`,
      );
    });

    // Rekorde 2×2 rechts
    const recX = 730;
    const recW = W - recX - 64;
    recordEntries.forEach(([label, rec], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = recX + col * (recW / 2 + 8);
      const ry = projY + 22 + row * 92;
      parts.push(
        `<rect x="${x}" y="${ry}" width="${recW / 2 - 8}" height="80" rx="12" fill="#211d2e"/>`,
        `<text x="${x + 14}" y="${ry + 26}" font-size="12" fill="#9a93b5">${esc(label)}</text>`,
        `<text x="${x + 14}" y="${ry + 52}" font-size="20" font-weight="700" fill="#ffffff">${esc(rec?.value ?? L.noData)}</text>`,
        `<text x="${x + 14}" y="${ry + 70}" font-size="10" fill="#776f96">${esc(rec?.title ?? "")}</text>`,
      );
    });
  } else {
    // Exclude-Layout: die VIER Rekord-Badges als volle zweite Reihe unter
    // der KPI-Zeile — 4 Spalten über die Gesamtbreite, Optik wie KPI-Zellen.
    const recRowY = kpiY + 86 + 20;
    const recCellH = 116;
    recordEntries.forEach(([label, rec], i) => {
      const x = 64 + i * cellW;
      parts.push(
        `<rect x="${x}" y="${recRowY}" width="${cellW - 16}" height="${recCellH}" rx="12" fill="#211d2e"/>`,
        `<text x="${x + 18}" y="${recRowY + 34}" font-size="15" fill="#9a93b5">${esc(label)}</text>`,
        `<text x="${x + 18}" y="${recRowY + 68}" font-size="26" font-weight="700" fill="#ffffff">${esc(rec?.value ?? L.noData)}</text>`,
        `<text x="${x + 18}" y="${recRowY + 92}" font-size="11" fill="#776f96">${esc(rec?.title ?? "")}</text>`,
      );
    });
  }

  // Footer
  const generated = new Intl.DateTimeFormat(
    data.lang === "de" ? "de-DE" : "en-US",
    { dateStyle: "medium", timeStyle: "short" },
  ).format(new Date());
  parts.push(
    `<text x="64" y="${H - 28}" font-size="14" fill="#776f96">${esc(generated)}</text>`,
    `<text x="${W - 64}" y="${H - 28}" font-size="14" fill="#776f96" text-anchor="end">opencode-usage</text>`,
  );

  parts.push("</svg>");
  return parts.join("\n");
}

/** SVG → PNG (1200 px breit) via resvg. */
export function renderSharePng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
  });
  return resvg.render().asPng();
}
