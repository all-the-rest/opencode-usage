/**
 * App shell: daisyUI navbar (with language switcher) + footer showing the
 * last-sync time (polled from /api/meta every 60s). Route content is rendered
 * through <Outlet /> inside a <Suspense> so lazy routes show a loading state.
 */

import { Suspense } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { getMeta, usePoll } from "../lib/api";
import { setLang, t, useLang, type Lang } from "../lib/i18n";

const NAV_ITEMS: { to: string; key: Parameters<typeof t>[0]; end?: boolean }[] = [
  { to: "/", key: "navDashboard", end: true },
  { to: "/models", key: "navModels" },
  { to: "/projects", key: "navProjects" },
  { to: "/sessions", key: "navSessions" },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? "active" : "";
}

function NavItems() {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} end={item.end} className={navClass}>
            {t(item.key)}
          </NavLink>
        </li>
      ))}
    </>
  );
}

function LanguageSwitcher() {
  const lang = useLang();
  return (
    <label className="flex items-center gap-2">
      <span className="hidden sm:inline text-sm opacity-70">{t("langLabel")}</span>
      <select
        className="select select-bordered select-sm"
        value={lang}
        aria-label={t("langLabel")}
        onChange={(e) => setLang(e.target.value as Lang)}
      >
        <option value="de">{t("langDe")}</option>
        <option value="en">{t("langEn")}</option>
      </select>
    </label>
  );
}

function Navbar() {
  return (
    <header className="navbar bg-base-200 shadow-sm sticky top-0 z-10">
      <div className="navbar-start">
        <div className="dropdown md:hidden">
          <div
            tabIndex={0}
            role="button"
            className="btn btn-ghost"
            aria-label="Menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </div>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-3 z-20 p-2 shadow bg-base-100 rounded-box w-52"
          >
            <NavItems />
          </ul>
        </div>
        <Link to="/" className="btn btn-ghost text-xl font-bold">
          {t("appTitle")}
        </Link>
      </div>

      <nav className="navbar-center hidden md:flex">
        <ul className="menu menu-horizontal gap-1 px-1">
          <NavItems />
        </ul>
      </nav>

      <div className="navbar-end">
        <LanguageSwitcher />
      </div>
    </header>
  );
}

function formatTime(ms: number | null, lang: Lang): string {
  if (ms == null) return "";
  const locale = lang === "de" ? "de-DE" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

function Footer() {
  const meta = usePoll(getMeta, 60_000);
  const lang = useLang();
  const time = formatTime(meta.data?.lastSync ?? null, lang);

  const syncText =
    meta.data?.lastSync != null
      ? t("footerLastSync", { time })
      : t("footerNoSync");

  return (
    <footer className="footer footer-center border-t border-base-300 p-4 text-sm text-base-content/70">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>{syncText}</span>
        {meta.data?.sourceDb && (
          <span>· {t("footerSource", { source: meta.data.sourceDb })}</span>
        )}
        {meta.error && <span className="text-error">· {t("stateError")}</span>}
      </div>
    </footer>
  );
}

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-16 opacity-70">
      {t("stateLoading")}
    </div>
  );
}

export default function Layout() {
  // Subscribe at the shell level so every t() call in the tree re-renders on
  // language change (t() reads the module-level lang, not component state).
  useLang();
  return (
    <div className="min-h-screen flex flex-col bg-base-100">
      <Navbar />
      <main className="flex-1 container mx-auto p-4">
        <Suspense fallback={<RouteFallback />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
