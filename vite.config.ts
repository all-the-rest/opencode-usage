import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
  ],
  server: {
    // Der Dev-Server wird über `tailscale serve` als
    // https://<node>.<tailnet>.ts.net/ aufgerufen. Vite blockt per Default jeden
    // unbekannten Host-Header (DNS-Rebinding-Schutz); der Tailscale-Hostname ist
    // weder `localhost` noch eine IP und muss daher explizit erlaubt werden —
    // sonst: "Blocked request. This host … is not allowed."
    //
    // Punkt-Präfix = die Domain selbst + alle Subdomains (Vite macht einen
    // Suffix-Match), deckt also alle Nodes im Tailnet ab.
    // NICHT `allowedHosts: true`: das schaltet die Prüfung komplett ab. Da der
    // Dev-Server auf 0.0.0.0 lauscht und /api/stats/* keine Auth hat, wäre das
    // eine offene Tür für DNS-Rebinding aus dem Browser heraus.
    // Wer nur den eigenen Tailnet zulassen will, nimmt stattdessen
    // `.<dein-tailnet>.ts.net` — `ts.net` ist der geteilte Suffix aller
    // Tailnets weltweit, nicht nur der eigene.
    // Mehrere Hosts kommagetrennt: DEV_ALLOWED_HOSTS=.ts.net,a.example
    allowedHosts: (process.env.DEV_ALLOWED_HOSTS ?? ".ts.net")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      "/api": "http://localhost:3712",
    },
  },
  build: {
    outDir: "dist",
  },
});
