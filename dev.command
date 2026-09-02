#!/bin/zsh
# dev.command — macOS Doppelklick-Starter für `pnpm dev:all`
# Lage: Projekt-Root (neben package.json). Doppelklick öffnet Terminal und startet watch+api+web.

set -e

# In Projektverzeichnis wechseln (egal von wo gestartet)
cd "$(dirname "$0")"

# PATH für Doppelklick-Kontext reparieren (Terminal.app ohne Login-Shell hat minimales PATH)
export PATH="$HOME/.local/bin:$HOME/Library/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # nvm laden falls vorhanden (stellt node/pnpm bereit)
  source "$NVM_DIR/nvm.sh" 2>/dev/null || true
fi
# .zshrc optional nachladen (falls pnpm/node dort konfiguriert)
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null || true

if [ ! -f "package.json" ]; then
  echo "Fehler: package.json nicht gefunden in $(pwd)" >&2
  echo "Stelle sicher, dass dev.command im Projekt-Root liegt." >&2
  echo "Taste drücken zum Schließen..."
  read -k 1
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Fehler: pnpm nicht gefunden (PATH=$PATH)" >&2
  echo "Installiere pnpm oder passe PATH oben im Skript an." >&2
  echo "Taste drücken zum Schließen..."
  read -k 1
  exit 1
fi

echo "→ Starte pnpm dev:all in $(pwd)"
echo "  Beenden mit Strg+C. Danach Fenster schließen."
echo ""

pnpm dev:all
STATUS=$?

echo ""
echo "[dev.command] dev:all beendet (Exit $STATUS). Fenster kann geschlossen werden."
# Fenster offen halten bis Tastendruck, damit Exit-Code lesbar bleibt
if [ $STATUS -ne 0 ]; then
  echo "Taste drücken zum Schließen..."
  read -k 1
fi
exit $STATUS
