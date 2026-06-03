#!/usr/bin/env bash
# Fetch pet avatar art (Microsoft Fluent Emoji, MIT licensed) into src/assets/pets/.
# One-time use: once the SVGs are committed, the app no longer needs the network.
# Source: https://github.com/microsoft/fluentui-emoji  (MIT)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/assets/pets"
BASE="https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets"
mkdir -p "$OUT"

# species_id  ->  "<RepoDir>/<file_stem>"  (Flat variant)
# species_id becomes the filename: <species_id>.svg
fetch() {
  local id="$1" dir="$2" stem="$3"
  local url="$BASE/$dir/Flat/${stem}_flat.svg"
  echo "→ $id  ($url)"
  curl -fsSL "$url" -o "$OUT/$id.svg"
}

fetch cat      "Cat"       "cat"
fetch dog      "Dog"       "dog"
fetch fox      "Fox"       "fox"
fetch panda    "Panda"     "panda"
fetch rabbit   "Rabbit"    "rabbit"
fetch hamster  "Hamster"   "hamster"
fetch penguin  "Penguin"   "penguin"
fetch frog     "Frog"      "frog"
fetch dino     "Sauropod"  "sauropod"
fetch unicorn  "Unicorn"   "unicorn"

echo "✓ Done. Saved $(ls "$OUT"/*.svg | wc -l | tr -d ' ') SVGs to src/assets/pets/"
