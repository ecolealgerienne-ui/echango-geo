#!/usr/bin/env bash
# §9 — un point en mer rend des coordonnées et des champs texte vides,
# PAS une erreur.
cd "$(dirname "$0")"
source ./_lib.sh

echo "== test-geocode-reverse =="

# ── Témoin : un point sur terre (centre d'Alger) rend une adresse ──────────
# Prouve que reverse atteint réellement Nominatim ; sans lui, un « champ
# vide » ci-dessous pourrait venir d'une panne silencieuse, pas de la mer.
geo_get "/v1/geocode/reverse?lat=36.7538&lon=3.0588"
assert_eq "200" "$GEO_HTTP" "témoin : point terrestre répond 200"
assert_nonempty "$(jget '.label')" "témoin : label non vide sur terre"
assert_nonempty "$(jget '.city // .province')" "témoin : composante d'adresse présente"

# ── Cas nominal : plein Atlantique, loin de toute côte ────────────────────
geo_get "/v1/geocode/reverse?lat=30.0&lon=-40.0"
assert_eq "200" "$GEO_HTTP" "point en mer répond 200 (jamais une erreur)"
assert_empty "$(jget '.label')"      "label vide"
assert_empty "$(jget '.shortLabel')" "shortLabel vide"
assert_empty "$(jget '.city')"       "city vide"
assert_empty "$(jget '.country')"    "country vide"
# Le point reste valide : les coordonnées demandées sont rendues telles quelles.
assert_eq "30" "$(jget '.latitude')"   "latitude rendue telle quelle"
assert_eq "-40" "$(jget '.longitude')" "longitude rendue telle quelle"

# ── Défaut gardé : coordonnées invalides → 400, pas un géocodage bidon ────
geo_get "/v1/geocode/reverse?lat=91&lon=3"
assert_eq "400" "$GEO_HTTP" "latitude 91 → 400"
assert_eq "geo.invalid_query" "$(jget '.code')" "code geo.invalid_query"

summary
