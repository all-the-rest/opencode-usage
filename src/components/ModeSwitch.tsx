/**
 * daisyUI join toggle for the Volumen / Kosten view mode, used by the Models
 * Top-10 and Projects bar charts (defaults to Volumen per user feedback).
 */

import { t } from "../lib/i18n";

export type ViewMode = "volume" | "cost";

export function ModeSwitch({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  const opts: ViewMode[] = ["volume", "cost"];
  return (
    <div className="join">
      {opts.map((m) => (
        <button
          key={m}
          className={`btn btn-xs join-item ${value === m ? "btn-primary" : ""}`}
          onClick={() => onChange(m)}
        >
          {t(m === "volume" ? "modeVolume" : "modeCost")}
        </button>
      ))}
    </div>
  );
}
