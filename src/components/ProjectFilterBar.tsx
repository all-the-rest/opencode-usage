/**
 * Global project filter bar, rendered directly below the navbar on every
 * route. The selection lives in the URL query param `project` (via
 * useSearchParams), so it survives navigation and any route can opt in by
 * reading the same param and forwarding it as FetchOpts to the API layer.
 *
 * The select lists every known project directory (display + value = basename;
 * the server matches the value as a directory-path suffix).
 */

import { useSearchParams } from "react-router";
import { getDirectories, usePoll } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { formatPeriodLabel, type PeriodUnit } from "../lib/period";

export const PROJECT_PARAM = "project";
export const PERIOD_PARAM = "period";
export const PPERIOD_PARAM = "pperiod";

/** Read the active global project filter (undefined = no filter). */
export function readProjectParam(
  params: URLSearchParams,
): string | undefined {
  const v = params.get(PROJECT_PARAM);
  return v != null && v !== "" ? v : undefined;
}

/** Read the active global period filter (start + unit), or null when unset. */
export function readPeriodParam(
  params: URLSearchParams,
): { start: string; unit: PeriodUnit } | null {
  const start = params.get(PERIOD_PARAM);
  const unitRaw = params.get(PPERIOD_PARAM);
  const unit: PeriodUnit | null =
    unitRaw === "day" || unitRaw === "week" || unitRaw === "month"
      ? unitRaw
      : null;
  if (start != null && /^\d{4}-\d{2}-\d{2}$/.test(start) && unit) {
    return { start, unit };
  }
  return null;
}

export default function ProjectFilterBar() {
  // Subscribe so t() output updates on language change.
  useLang();
  const lang = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const dirs = usePoll(getDirectories, 60_000);
  const project = readProjectParam(searchParams);
  const period = readPeriodParam(searchParams);

  /** Set/clear the project filter while preserving all other query params. */
  const update = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(PROJECT_PARAM, value);
    else params.delete(PROJECT_PARAM);
    setSearchParams(params);
  };

  /** Clear the global period filter (preserves project + everything else). */
  const clearPeriod = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(PERIOD_PARAM);
    params.delete(PPERIOD_PARAM);
    setSearchParams(params);
  };

  // Different paths can share a basename — dedupe for the option list.
  const options = [
    ...new Set((dirs.data ?? []).map((d) => d.basename)),
  ].sort((a, b) => a.localeCompare(b));

  return (
    <div className="border-b border-base-300 bg-base-200/50">
      <div className="container mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="opacity-70">{t("globalProjectFilter")}</span>
          <select
            className="select select-bordered select-sm max-w-64"
            value={project ?? ""}
            aria-label={t("globalProjectFilter")}
            onChange={(e) => update(e.target.value)}
          >
            <option value="">{t("globalProjectAll")}</option>
            {options.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        {project && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="badge badge-primary badge-outline gap-1">
              <span className="max-w-48 truncate">{project}</span>
              <button
                type="button"
                className="cursor-pointer opacity-70 hover:opacity-100"
                aria-label={t("globalProjectAll")}
                title={t("globalProjectAll")}
                onClick={() => update("")}
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {period && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="badge badge-secondary gap-1">
              <span className="max-w-56 truncate">
                {t("rangeChip", {
                  label: formatPeriodLabel(period.start, period.unit, lang === "de" ? "de-DE" : "en-US"),
                })}
              </span>
              <button
                type="button"
                className="cursor-pointer opacity-70 hover:opacity-100"
                aria-label={t("rangeClear")}
                title={t("rangeClear")}
                onClick={clearPeriod}
              >
                ✕
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

