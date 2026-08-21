/**
 * Shared placeholder used by the initial route stubs. Later agents replace the
 * individual route files in src/routes/; this component keeps the "coming soon"
 * presentation consistent until the real pages land.
 */

import { t } from "../lib/i18n";

export function PlaceholderPage({
  titleKey,
}: {
  titleKey: Parameters<typeof t>[0];
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t(titleKey)}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body items-center text-center gap-1">
            <p className="text-base-content/80">{t("commonComingSoon")}</p>
            <p className="text-sm text-base-content/50">
              {t("commonComingSoonHint")}
            </p>
          </div>
        </div>
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body" />
        </div>
        <div className="card bg-base-200 shadow-sm">
          <div className="card-body" />
        </div>
      </div>
    </div>
  );
}
