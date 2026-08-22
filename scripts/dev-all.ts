// scripts/dev-all.ts — Ein-Befehl-Dev-Umgebung.
//
// Startet alle drei Prozesse, die für `pnpm dev` nötig sind:
//   1. watch  – Extractor im Watch-Modus (opencode.db → data/stats.db)
//   2. api    – Hono-API auf :3712
//   3. web    – Vite-Dev-Server auf :5173 (proxied /api → :3712)
//
// Verhalten:
//   - Jede Ausgabezeile ist mit [watch]/[api]/[web] farbig präfixiert.
//   - Strg+C beendet ALLE Prozesse sauber (SIGTERM → SIGKILL-Fallback).
//   - Bricht ein Prozess unerwartet ab, wird der komplette Stack
//     heruntergefahren (Fail-fast, kein Halbwissen über tote Teile).
import { spawn, type ChildProcess } from "node:child_process";

const COLORS = {
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
} as const;

type Proc = { name: string; child: ChildProcess };

const procs: Proc[] = [];
let stopping = false;

function forward(stream: NodeJS.ReadableStream | null, prefix: string): void {
  if (!stream) return;
  let buf = "";
  stream.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      process.stdout.write(`${prefix} ${line}\n`);
    }
    // Zeile ohne abschließendes \n (z. B. Spinner) einfach verwerfen —
    // die drei Skripte schreiben ihre Ausgabe immer zeilenweise.
    buf = "";
  });
}

function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const { child } of procs) child.kill("SIGTERM");
  setTimeout(() => {
    for (const { child } of procs) child.kill("SIGKILL");
  }, 2000).unref();
  process.exit(code);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function start(
  name: string,
  color: string,
  command: string,
  args: string[],
): void {
  const prefix = `${color}[${name}]${COLORS.reset}`;
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  procs.push({ name, child });
  forward(child.stdout, prefix);
  forward(child.stderr, prefix);
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(
      `${COLORS.red}[dev-all]${COLORS.reset} "${name}" wurde unerwartet beendet (code ${code ?? "?"}) — fahre alles herunter.`,
    );
    stop(code ?? 1);
  });
}

start("watch", COLORS.cyan, "pnpm", ["exec", "tsx", "scripts/watch.ts"]);
start("api", COLORS.magenta, "pnpm", ["exec", "tsx", "server/index.ts"]);
start("web", COLORS.yellow, "pnpm", ["exec", "vite"]);

console.log(
  `[dev-all] Läuft: watch + api (:3712) + vite (:5173). Beenden mit Strg+C.`,
);
