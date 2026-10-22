#!/bin/sh
# Prépare le dossier à mettre en ligne (Netlify, GitHub Pages…), à côté du projet : ../ptit-malin-en-ligne
# Il ne contient que ce dont l'appli a besoin. Restent en dehors :
#   - outils/              (scripts, et prenoms.txt qui contient les prénoms des enfants)
#   - voix/phrases.json    (texte de chaque phrase, prénoms compris : l'appli ne s'en sert pas)
# À relancer après chaque modification, avant de redéposer le dossier.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(dirname "$ROOT")/ptit-malin-en-ligne"

rm -rf "$OUT"
mkdir -p "$OUT/sons" "$OUT/voix"
cp "$ROOT"/index.html "$ROOT"/app.js "$ROOT"/styles.css "$ROOT"/sw.js "$ROOT"/manifest.webmanifest "$ROOT"/icon.svg "$OUT/"
cp "$ROOT"/sons/*.mp3 "$OUT/sons/"
cp "$ROOT"/voix/*.mp3 "$ROOT"/voix/manifest.js "$OUT/voix/"

echo "Dossier prêt : $OUT"
echo "$(find "$OUT" -type f | wc -l | tr -d ' ') fichiers, $(du -sh "$OUT" | cut -f1)"
