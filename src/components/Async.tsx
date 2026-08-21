/**
 * Shared async UI states: a daisyUI loading spinner and an error block with a
 * retry button. Both consume the existing `useApi` / `usePoll` error shape.
 */

import type { ReactNode } from "react";
import { t } from "../lib/i18n";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-base-content/70">
      <span className="loading loading-spinner loading-lg" aria-hidden />
      <span>{label ?? t("stateLoading")}</span>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-box border border-error/40 bg-error/10 p-6 text-center"
    >
      <p className="font-medium text-error">{t("stateError")}</p>
      {error && (
        <p className="text-sm text-base-content/70">
          {t("stateErrorDetail", { message: error.message })}
        </p>
      )}
      {onRetry && (
        <button className="btn btn-sm btn-error" onClick={onRetry}>
          {t("stateRetry")}
        </button>
      )}
    </div>
  );
}

/**
 * Compact, actionable empty-state message for charts/tables that have no data
 * yet. Renders the shared `chartEmpty` string.
 */
export function EmptyState() {
  return (
    <p className="text-center text-sm text-base-content/60">{t("chartEmpty")}</p>
  );
}

/** Render spinner while loading, error block on error, else children. */
export function AsyncState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return <>{children}</>;
}
