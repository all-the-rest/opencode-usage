/**
 * Share dialog ("Teilen") — daisyUI `modal modal-open`, controlled entirely by
 * URL params (?share=today|yesterday|week|lastweek|month|lastmonth,
 * ?shareproj=all|hide|none,
 * ?sharelang=de|en) so any dialog state is a shareable link (rule "URL-Sync").
 *
 * Shows a server-rendered preview card (GET /api/stats/share.svg, 1200×630,
 * dark social-media design) and offers the actions PNG download / PNG to
 * clipboard / SVG in a new tab. All three endpoints receive the same query
 * string: range, IMAGE language (independent of the UI language), the global
 * ?project filter and the project mode (include / hide names / exclude).
 *
 * Closing is handled by the parent (removes the params from the URL): via the
 * ✕ button top right or a click on the modal backdrop.
 */

import { useEffect, useRef, useState } from "react";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";

export type ShareRange =
  | "today"
  | "yesterday"
  | "week"
  | "lastweek"
  | "month"
  | "lastmonth";
export type ShareProjectsMode = "all" | "hide" | "none";

const RANGES: {
  value: ShareRange;
  labelKey:
    | "shareToday"
    | "shareYesterday"
    | "shareWeek"
    | "shareLastWeek"
    | "shareMonth"
    | "shareLastMonth";
}[] = [
  { value: "today", labelKey: "shareToday" },
  { value: "yesterday", labelKey: "shareYesterday" },
  { value: "week", labelKey: "shareWeek" },
  { value: "lastweek", labelKey: "shareLastWeek" },
  { value: "month", labelKey: "shareMonth" },
  { value: "lastmonth", labelKey: "shareLastMonth" },
];

const PROJECT_MODES: {
  value: ShareProjectsMode;
  labelKey: "shareProjAll" | "shareProjHide" | "shareProjNone";
}[] = [
  { value: "all", labelKey: "shareProjAll" },
  { value: "hide", labelKey: "shareProjHide" },
  { value: "none", labelKey: "shareProjNone" },
];

function rangeLabelKey(range: ShareRange) {
  return range === "today"
    ? "shareToday"
    : range === "yesterday"
      ? "shareYesterday"
      : range === "week"
        ? "shareWeek"
        : range === "lastweek"
          ? "shareLastWeek"
          : range === "month"
            ? "shareMonth"
            : "shareLastMonth";
}

/** Query string shared by all three share endpoints. */
function shareQuery(
  range: ShareRange,
  project: string | undefined,
  projects: ShareProjectsMode,
  imgLang: Lang,
): string {
  const params = new URLSearchParams();
  params.set("range", range);
  params.set("lang", imgLang);
  if (project) params.set("project", project);
  if (projects !== "all") params.set("projects", projects);
  return params.toString();
}

export default function ShareDialog({
  range,
  project,
  projects,
  imgLang,
  onRange,
  onProjects,
  onImgLang,
  onClose,
}: {
  range: ShareRange;
  /** Global project filter (?project=), forwarded to every share endpoint. */
  project?: string;
  /** Project section mode: include / include-with-hidden-names / exclude. */
  projects: ShareProjectsMode;
  /** Language of the RENDERED CARD — independent of the UI language. */
  imgLang: Lang;
  onRange: (range: ShareRange) => void;
  onProjects: (mode: ShareProjectsMode) => void;
  onImgLang: (lang: Lang) => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const qs = shareQuery(range, project, projects, imgLang);
  const svgUrl = `/api/stats/share.svg?${qs}`;
  const pngUrl = `/api/stats/share.png?${qs}`;

  /** Fetch the rasterized card and offer it as a file download. */
  const downloadPng = async (): Promise<void> => {
    try {
      const res = await fetch(pngUrl);
      if (!res.ok) return; // endpoint not ready / failed — nothing to download
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opencode-usage-${range}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Network error — silently ignore, there is nothing to download.
    }
  };

  /** Copy the PNG blob to the clipboard, with a short success feedback. */
  const copyPng = async (): Promise<void> => {
    try {
      const res = await fetch(pngUrl);
      if (!res.ok) throw new Error(`PNG request failed (${res.status})`);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      if (copyTimerRef.current != null)
        window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/blocked or fetch failed — no feedback.
    }
  };

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-4xl space-y-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold">{t("shareTitle")}</h3>
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            aria-label={t("shareClose")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Range segmented control */}
        <div className="join">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`btn btn-sm join-item ${range === r.value ? "btn-primary" : ""}`}
              onClick={() => onRange(r.value)}
            >
              {t(r.labelKey)}
            </button>
          ))}
        </div>

        {/* Project section mode: include / hide names / exclude entirely */}
        <div className="space-y-1">
          <span className="text-sm opacity-70">{t("shareProjectsLabel")}</span>
          <div className="join">
            {PROJECT_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`btn btn-sm join-item ${projects === m.value ? "btn-primary" : ""}`}
                onClick={() => onProjects(m.value)}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Image language — independent of the UI language */}
        <div className="space-y-1">
          <span className="text-sm opacity-70">{t("shareImageLang")}</span>
          <div className="join">
            {(["de", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                className={`btn btn-sm join-item ${imgLang === l ? "btn-primary" : ""}`}
                onClick={() => onImgLang(l)}
              >
                {l === "de" ? "DE" : "EN"}
              </button>
            ))}
          </div>
        </div>

        {/* Server-rendered preview card */}
        <div className="rounded-box overflow-hidden border border-base-300 bg-base-300">
          <img
            src={svgUrl}
            alt={t("shareAltText", { range: t(rangeLabelKey(range)) })}
            width={1200}
            height={630}
            className="block h-auto w-full"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={downloadPng}>
            {t("shareDownload")}
          </button>
          <button type="button" className="btn btn-sm" onClick={copyPng}>
            {copied ? t("shareCopied") : t("shareCopy")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => window.open(svgUrl, "_blank", "noopener")}
          >
            {t("shareOpenSvg")}
          </button>
        </div>
      </div>

      {/* Click-catcher behind the box (not focusable; the ✕ above is the
          accessible close control). */}
      <div
        className="modal-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
    </div>
  );
}
