#!/usr/bin/env bash
# §9 — une adresse connue rend un Place décomposé (rue/quartier/commune/wilaya).
cd "$(dirname "$0")"
source ./_lib.sh

echo "== test-geocode-search =="

# ── Témoin : l'endpoint est vivant et le cas « rien trouvé » se distingue ────
# d'une panne (HTTP 200, tableau vide, jamais une erreur).
body="$(geo_get "/v1/geocode/search?q=zzzzzzzzzzzz+introuvable")"
assert_eq "200" "$GEO_HTTP" "témoin : requête absurde répond 200"
assert_eq "0" "$(jq '.results | length' <<<"$body")" "témoin : 0 résultat, pas une erreur"

# ── Cas nominal : une adresse algérienne connue, décomposée ─────────────────
body="$(geo_get "/v1/geocode/search?q=Rue+Larbi+Tebessi+Alger&country=dz&limit=5")"
assert_eq "200" "$GEO_HTTP" "adresse connue répond 200"

first="$(jq '.results[0]' <<<"$body")"
assert_ne "null" "$first" "au moins un résultat"
assert_nonempty "$(jq -r '.results[0].label' <<<"$body")"      "label présent"
assert_nonempty "$(jq -r '.results[0].shortLabel' <<<"$body")" "shortLabel présent"
assert_nonempty "$(jq -r '.results[0].city' <<<"$body")"       "city (commune) présente"
assert_nonempty "$(jq -r '.results[0].province' <<<"$body")"   "province (wilaya) présente"
assert_eq "DZ" "$(jq -r '.results[0].country' <<<"$body")"     "country en ISO-2 majuscule"

lat="$(jq -r '.results[0].latitude' <<<"$body")"
lon="$(jq -r '.results[0].longitude' <<<"$body")"
# Alger : ~36.7 N, ~3.05 E. On vérifie l'ordre de grandeur, pas la précision.
awk -v a="$lat" 'BEGIN{exit !(a>35 && a<38)}' && ok "latitude plausible ($lat)" || ko "latitude hors Algérie ($lat)"
awk -v o="$lon" 'BEGIN{exit !(o>1 && o<4)}'   && ok "longitude plausible ($lon)" || ko "longitude hors Algérie ($lon)"

# ── Défaut gardé : sous 3 caractères, la validation refuse (geo.invalid_query) ─
body="$(geo_get "/v1/geocode/search?q=ab")"
assert_eq "400" "$GEO_HTTP" "q trop court → 400"
assert_eq "geo.invalid_query" "$(jq -r '.code' <<<"$body")" "code geo.invalid_query"

summary
