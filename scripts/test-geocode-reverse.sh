#!/usr/bin/env bash
# §9 — un point en mer rend des coordonnées et des champs texte vides,
# PAS une erreur.
cd "$(dirname "$0")"
source ./_lib.sh

echo "== test-geocode-reverse =="

# ── Témoin : un point sur terre (centre d'Alger) rend une adresse ──────────
# Prouve que reverse atteint réellement Nominatim ; sans lui, un « champ
# vide » ci-dessous pourrait venir d'une panne silencieuse, pas de la mer.
body="$(geo_get "/v1/geocode/reverse?lat=36.7538&lon=3.0588")"
assert_eq "200" "$GEO_HTTP" "témoin : point terrestre répond 200"
assert_nonempty "$(jq -r '.label' <<<"$body")" "témoin : label non vide sur terre"
assert_nonempty "$(jq -r '.city // .province' <<<"$body")" "témoin : composante d'adresse présente"

# ── Cas nominal : plein Atlantique, loin de toute côte ────────────────────
body="$(geo_get "/v1/geocode/reverse?lat=30.0&lon=-40.0")"
assert_eq "200" "$GEO_HTTP" "point en mer répond 200 (jamais une erreur)"
assert_empty "$(jq -r '.label' <<<"$body")"      "label vide"
assert_empty "$(jq -r '.shortLabel' <<<"$body")" "shortLabel vide"
assert_empty "$(jq -r '.city' <<<"$body")"       "city vide"
assert_empty "$(jq -r '.country' <<<"$body")"    "country vide"
# Le point reste valide : les coordonnées demandées sont rendues telles quelles.
assert_eq "30" "$(jq -r '.latitude'  <<<"$body")" "latitude rendue telle quelle"
assert_eq "-40" "$(jq -r '.longitude' <<<"$body")" "longitude rendue telle quelle"

# ── Défaut gardé : coordonnées invalides → 400, pas un géocodage bidon ────
body="$(geo_get "/v1/geocode/reverse?lat=91&lon=3")"
assert_eq "400" "$GEO_HTTP" "latitude 91 → 400"
assert_eq "geo.invalid_query" "$(jq -r '.code' <<<"$body")" "code geo.invalid_query"

summary
