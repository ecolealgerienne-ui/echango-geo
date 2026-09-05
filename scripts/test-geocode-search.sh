#!/usr/bin/env bash
# §9 — une adresse connue rend un Place décomposé (rue/quartier/commune/wilaya).
cd "$(dirname "$0")"
source ./_lib.sh

echo "== test-geocode-search =="

# ── Témoin : l'endpoint est vivant et le cas « rien trouvé » se distingue ────
# d'une panne (HTTP 200, tableau vide, jamais une erreur).
geo_get "/v1/geocode/search?q=zzzzzzzzzzzz+introuvable"
assert_eq "200" "$GEO_HTTP" "témoin : requête absurde répond 200"
assert_eq "0" "$(jget '.results | length')" "témoin : 0 résultat, pas une erreur"

# ── Cas nominal : une adresse algérienne connue, décomposée ─────────────────
geo_get "/v1/geocode/search?q=Rue+Larbi+Tebessi+Alger&country=dz&limit=5"
assert_eq "200" "$GEO_HTTP" "adresse connue répond 200"

assert_ne "null" "$(jget '.results[0]')" "au moins un résultat"
assert_nonempty "$(jget '.results[0].label')"      "label présent"
assert_nonempty "$(jget '.results[0].shortLabel')" "shortLabel présent"
assert_nonempty "$(jget '.results[0].city')"       "city (commune) présente"
assert_nonempty "$(jget '.results[0].province')"   "province (wilaya) présente"
assert_eq "DZ" "$(jget '.results[0].country')"     "country en ISO-2 majuscule"

lat="$(jget '.results[0].latitude')"
lon="$(jget '.results[0].longitude')"
# Alger : ~36.7 N, ~3.05 E. On vérifie l'ordre de grandeur, pas la précision.
awk -v a="$lat" 'BEGIN{exit !(a>34 && a<38)}' && ok "latitude plausible ($lat)" || ko "latitude hors Algérie ($lat)"
awk -v o="$lon" 'BEGIN{exit !(o>1 && o<5)}'   && ok "longitude plausible ($lon)" || ko "longitude hors Algérie ($lon)"

# ── Défaut gardé : sous 3 caractères, la validation refuse (geo.invalid_query) ─
geo_get "/v1/geocode/search?q=ab"
assert_eq "400" "$GEO_HTTP" "q trop court → 400"
assert_eq "geo.invalid_query" "$(jget '.code')" "code geo.invalid_query"

summary
