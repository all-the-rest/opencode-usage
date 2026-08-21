/**
 * Minimal i18n without any library.
 *
 * Pattern (per AGENTS.md): `Lang = "de" | "en"`, plain-object dictionaries with
 * identical keys, `{placeholder}`-interpolation via `t(key, vars)`. Lang state is
 * module-level and exposed to React through `useSyncExternalStore`. The active
 * language is persisted in localStorage (key "lang"); the default is "de".
 */

import { useSyncExternalStore } from "react";

export type Lang = "de" | "en";

export const i18n = {
  de: {
    // --- App / brand ---
    appTitle: "opencode-usage",
    appTagline: "Lokales Dashboard für OpenCode-Token- und Kostenverbrauch",

    // --- Navigation ---
    navDashboard: "Dashboard",
    navModels: "Modelle",
    navProjects: "Projekte",
    navSessions: "Sessions",

    // --- Language switcher ---
    langLabel: "Sprache",
    langDe: "DE",
    langEn: "EN",

    // --- Footer ---
    footerLastSync: "Datenstand: {time}",
    footerNoSync: "Noch kein Datenstand",
    footerSource: "Quelle: {source}",

    // --- KPI labels (dashboard cards) ---
    kpiTotalTokens: "Gesamt-Tokens",
    kpiCost: "Kosten",
    kpiSessions: "Sessions",
    kpiMessages: "Nachrichten",
    kpiCacheHitRatio: "Cache-Hit-Ratio",
    kpiPeriod: "Zeitraum",
    kpiFrom: "von {from}",
    kpiTo: "bis {to}",

    // --- Loading / error states ---
    stateLoading: "Lädt…",
    stateError: "Fehler beim Laden der Daten.",
    stateErrorDetail: "Fehler: {message}",
    stateRetry: "Erneut versuchen",
    stateNoData: "Keine Daten verfügbar.",
    chartEmpty:
      "Keine Daten vorhanden. Starte opencode und nutze es normal – dieses Dashboard sammelt deinen Verbrauch.",

    // --- Generic ---
    commonComingSoon: "Diese Seite wird noch implementiert.",
    commonComingSoonHint: "Die Inhalte liefert ein späterer Agent.",
    commonPlaceholderTitle: "{page} wird implementiert",

    // --- Route page titles ---
    routeDashboard: "Dashboard",
    routeModels: "Modelle",
    routeProjects: "Projekte",
    routeSessions: "Sessions",

    // --- Table headers ---
    colTokens: "Tokens",
    colCost: "Kosten",
    colMessages: "Nachrichten",
    colCacheRatio: "Cache-Ratio",
    colProject: "Projekt",
    colModel: "Modell",
    colTitle: "Titel",
    colDate: "Datum",
    colProvider: "Anbieter",
    colFamily: "Familie",
    colManufacturer: "Hersteller",
    colSessions: "Sessions",
    colDirectory: "Verzeichnis",
    colAgent: "Agent",
    colTotalTokens: "Total-Tokens",

    // --- Cache analysis ---
    cacheAnalysis: "Cache-Analyse",
    cacheMsgVsRatio: "Nachrichtenanzahl vs. Cache-Hit-Ratio",
    cacheCorrelation: "Korrelation (Pearson)",
    cacheCorrelationNone: "Keine Korrelation berechenbar",
    cacheBucketAvg: "Durchschnittliche Cache-Hit-Ratio nach Nachrichtenanzahl",
    cacheBucket: "Bucket {bucket}",
    cacheNoData: "Keine Cache-Daten verfügbar.",
    cacheExcludedHint:
      "Sessions mit weniger als {n} Nachrichten sind ausgeschlossen — die Cache-Hit-Ratio stabilisiert sich erst nach Kontextaufbau.",
    cacheThreshold: "Mindest-Nachrichten",

    // --- Heatmap ---
    heatmapTitle: "Aktivitäts-Heatmap",
    heatmapLess: "Weniger",
    heatmapMore: "Mehr",
    heatmapHour: "Stunde {hour}",
    heatmapDay: "Tag",
    heatmapCount: "{count} Nachrichten",

    // --- Charts / dashboard controls ---
    chartTokenTrend: "Token-Zeitverlauf",
    chartCostTrend: "Kostenverlauf",
    granularity: "Auflösung",
    granDay: "Tag",
    granWeek: "Woche",
    granMonth: "Monat",
    groupBy: "Gruppieren nach",
    groupTotal: "Gesamt",
    groupProvider: "Anbieter",
    groupFamily: "Familie",
    groupManufacturer: "Hersteller",
    tokInput: "Input",
    tokOutput: "Output",
    tokReasoning: "Reasoning",
    tokCacheRead: "Cache-Read",
    ofTotalCost: "der Gesamtkosten",
    seriesOther: "Andere",
    heatmapWeek: "Woche",
    heatmapEmpty: "Keine Aktivität",
    chartTokenShareDay: "Token-Anteile pro Tag",
    modeVolume: "Volumen",
    modeCost: "Kosten",
    cardTotal: "Gesamt",

    // --- Models page ---
    modelsBreakdown: "Modell-Aufschlüsselung",
    modelsByProvider: "Token-Anteil nach Anbieter",
    modelsByFamily: "Token-Anteil nach Familie",
    modelsByManufacturer: "Token-Anteil nach Hersteller",
    modelsTopCost: "Top 10 Modelle nach Kosten",
    modelsTopVolume: "Top 10 Modelle nach Volumen",
    modelsContext: "Kontextfenster",
    modelsMetaLoading: "Modell-Metadaten werden geladen…",
    modelsMetaError: "Metadaten nicht verfügbar – DB-Namen werden verwendet.",
    modelsFilterEmpty: "Keine Modelle für diese Filter",
    filterProvider: "Anbieter",
    filterModel: "Modell",
    filterModelPlaceholder: "Modell tippen oder auswählen…",
    filterManufacturer: "Hersteller",
    filterFamily: "Familie",
    filterFree: "Preis",
    filterAll: "Alle",
    filterFreeOnly: "Nur gratis",
    filterFreePaid: "Nur bezahlte",
    filterReset: "Filter zurücksetzen",
    priceAnalysis: "Preis-Analyse",
    colTokenMix: "Token-Mix",
    colListPrice: "Listenpreis / 1M",
    colEffectivePrice: "Effektiver Preis",
    colTheoPrice: "Theoret. Preis",
    priceInput: "Input",
    priceCacheRead: "Cache-Read",
    priceOutput: "Output",
    pricePerM: "/ 1M Tokens",
    footerAvgPrice: "Dein Ø-Preis",

    // --- Projects page ---
    projectsChart: "Top-Projekte nach Kosten",
    projectsChartVolume: "Top-Projekte nach Volumen",
    colLastActivity: "Letzte Aktivität",
    projectNone: "(ohne Projekt)",

    // --- Sessions page ---
    sessionsFilter: "Filtern (Titel / Verzeichnis)…",
    sessionsPrev: "Zurück",
    sessionsNext: "Weiter",
    sessionsShowing: "Zeige {from}–{to}",
    sessionsDetail: "Sitzungsdetails",
    sessionsBreakdown: "Token-Aufschlüsselung",
    sessionsUntitled: "Ohne Titel",
    sessionsNew: "Neue Session",

    // --- Cache analysis (extended) ---
    cacheRegression: "Regression (r = {r})",
    cacheScatterX: "Nachrichten",
    cacheScatterY: "Cache-Hit-Ratio (%)",
    corrStrong: "Starke {dir} Korrelation",
    corrWeak: "Schwache {dir} Korrelation",
    corrNone2: "Keine relevante Korrelation",
    corrDirPos: "positive",
    corrDirNeg: "negative",
    corrValue: "Pearson r = {value}",
    corrSummary: "Mehr Nachrichten je Sitzung gehen mit {dir} Cache-Hit-Ratio einher.",
  },
  en: {
    // --- App / brand ---
    appTitle: "opencode-usage",
    appTagline: "Local dashboard for OpenCode token and cost usage",

    // --- Navigation ---
    navDashboard: "Dashboard",
    navModels: "Models",
    navProjects: "Projects",
    navSessions: "Sessions",

    // --- Language switcher ---
    langLabel: "Language",
    langDe: "DE",
    langEn: "EN",

    // --- Footer ---
    footerLastSync: "Last updated: {time}",
    footerNoSync: "No data sync yet",
    footerSource: "Source: {source}",

    // --- KPI labels (dashboard cards) ---
    kpiTotalTokens: "Total tokens",
    kpiCost: "Cost",
    kpiSessions: "Sessions",
    kpiMessages: "Messages",
    kpiCacheHitRatio: "Cache hit ratio",
    kpiPeriod: "Period",
    kpiFrom: "from {from}",
    kpiTo: "to {to}",

    // --- Loading / error states ---
    stateLoading: "Loading…",
    stateError: "Failed to load data.",
    stateErrorDetail: "Error: {message}",
    stateRetry: "Retry",
    stateNoData: "No data available.",
    chartEmpty:
      "No data yet. Start opencode and use it normally — this dashboard collects your usage.",

    // --- Generic ---
    commonComingSoon: "This page is not implemented yet.",
    commonComingSoonHint: "Content will be provided by a later agent.",
    commonPlaceholderTitle: "{page} is being implemented",

    // --- Route page titles ---
    routeDashboard: "Dashboard",
    routeModels: "Models",
    routeProjects: "Projects",
    routeSessions: "Sessions",

    // --- Table headers ---
    colTokens: "Tokens",
    colCost: "Cost",
    colMessages: "Messages",
    colCacheRatio: "Cache ratio",
    colProject: "Project",
    colModel: "Model",
    colTitle: "Title",
    colDate: "Date",
    colProvider: "Provider",
    colFamily: "Family",
    colManufacturer: "Manufacturer",
    colSessions: "Sessions",
    colDirectory: "Directory",
    colAgent: "Agent",
    colTotalTokens: "Total tokens",

    // --- Cache analysis ---
    cacheAnalysis: "Cache analysis",
    cacheMsgVsRatio: "Message count vs. cache hit ratio",
    cacheCorrelation: "Correlation (Pearson)",
    cacheCorrelationNone: "No correlation available",
    cacheBucketAvg: "Average cache hit ratio by message count",
    cacheBucket: "Bucket {bucket}",
    cacheNoData: "No cache data available.",
    cacheExcludedHint:
      "Sessions with fewer than {n} messages are excluded — the cache hit ratio only stabilizes after context build-up.",
    cacheThreshold: "Min messages",

    // --- Heatmap ---
    heatmapTitle: "Activity heatmap",
    heatmapLess: "Less",
    heatmapMore: "More",
    heatmapHour: "Hour {hour}",
    heatmapDay: "Day",
    heatmapCount: "{count} messages",

    // --- Charts / dashboard controls ---
    chartTokenTrend: "Token trend",
    chartCostTrend: "Cost trend",
    granularity: "Granularity",
    granDay: "Day",
    granWeek: "Week",
    granMonth: "Month",
    groupBy: "Group by",
    groupTotal: "Total",
    groupProvider: "Provider",
    groupFamily: "Family",
    groupManufacturer: "Manufacturer",
    tokInput: "Input",
    tokOutput: "Output",
    tokReasoning: "Reasoning",
    tokCacheRead: "Cache read",
    ofTotalCost: "of total cost",
    seriesOther: "Other",
    heatmapWeek: "Week",
    heatmapEmpty: "No activity",
    chartTokenShareDay: "Token share per day",
    modeVolume: "Volume",
    modeCost: "Cost",
    cardTotal: "Total",

    // --- Models page ---
    modelsBreakdown: "Model breakdown",
    modelsByProvider: "Token share by provider",
    modelsByFamily: "Token share by family",
    modelsByManufacturer: "Token share by manufacturer",
    modelsTopCost: "Top 10 models by cost",
    modelsTopVolume: "Top 10 models by volume",
    modelsContext: "Context window",
    modelsMetaLoading: "Loading model metadata…",
    modelsMetaError: "Metadata unavailable – using DB names.",
    modelsFilterEmpty: "No models match these filters",
    filterProvider: "Provider",
    filterModel: "Model",
    filterModelPlaceholder: "Type or pick a model…",
    filterManufacturer: "Manufacturer",
    filterFamily: "Family",
    filterFree: "Price",
    filterAll: "All",
    filterFreeOnly: "Free only",
    filterFreePaid: "Paid only",
    filterReset: "Reset filters",
    priceAnalysis: "Price analysis",
    colTokenMix: "Token mix",
    colListPrice: "List price / 1M",
    colEffectivePrice: "Effective price",
    colTheoPrice: "Theoretical price",
    priceInput: "Input",
    priceCacheRead: "Cache read",
    priceOutput: "Output",
    pricePerM: "/ 1M tokens",
    footerAvgPrice: "Your avg price",

    // --- Projects page ---
    projectsChart: "Top projects by cost",
    projectsChartVolume: "Top projects by volume",
    colLastActivity: "Last activity",
    projectNone: "(no project)",

    // --- Sessions page ---
    sessionsFilter: "Filter (title / directory)…",
    sessionsPrev: "Previous",
    sessionsNext: "Next",
    sessionsShowing: "Showing {from}–{to}",
    sessionsDetail: "Session details",
    sessionsBreakdown: "Token breakdown",
    sessionsUntitled: "Untitled",
    sessionsNew: "New session",

    // --- Cache analysis (extended) ---
    cacheRegression: "Regression (r = {r})",
    cacheScatterX: "Messages",
    cacheScatterY: "Cache hit ratio (%)",
    corrStrong: "Strong {dir} correlation",
    corrWeak: "Weak {dir} correlation",
    corrNone2: "No relevant correlation",
    corrDirPos: "positive",
    corrDirNeg: "negative",
    corrValue: "Pearson r = {value}",
    corrSummary: "More messages per session correlate with a {dir} cache hit ratio.",
  },
} as const;

type Dict = (typeof i18n)["de"];
export type TranslationKey = keyof Dict;

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

// --- Module-level language state (React-external, persisted) ---

const STORAGE_KEY = "lang";

function readInitialLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "de" || stored === "en") return stored;
  }
  return "de";
}

let currentLang: Lang = readInitialLang();
const langListeners = new Set<() => void>();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, lang);
  }
  for (const listener of langListeners) listener();
}

function subscribeLang(listener: () => void): () => void {
  langListeners.add(listener);
  return () => {
    langListeners.delete(listener);
  };
}

/** React hook returning the active language and re-rendering on change. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** Translate a key in the active language, interpolating `{var}` placeholders. */
export function t(
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  return interpolate(i18n[currentLang][key], vars);
}
