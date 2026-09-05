#!/usr/bin/env bash
# §9 — country=fr (non supporté) refusé en geo.country_not_configured,
# jamais une recherche silencieuse dans le vide.
cd "$(dirname "$0")"
source ./_lib.sh

echo "== test-pays-restriction =="

# ── Témoin : un pays supporté passe ──────────────────────────────────────
# Prouve que ce qui bloque `fr` est bien la restriction, pas un endpoint
# cassé qui renverrait 400 pour tout.
body="$(geo_get "/v1/geocode/search?q=alger+centre&country=dz")"
assert_eq "200" "$GEO_HTTP" "témoin : country=dz répond 200"

# ── Cas gardé : fr n'est pas dans GEO_SUPPORTED_COUNTRIES ────────────────
body="$(geo_get "/v1/geocode/search?q=paris&country=fr")"
assert_eq "400" "$GEO_HTTP" "country=fr → 400 (et non 200 à résultat vide)"
assert_eq "geo.country_not_configured" "$(jq -r '.code' <<<"$body")" "code geo.country_not_configured"

# ── Un des pays d'une liste est non supporté → toute la requête est refusée ─
body="$(geo_get "/v1/geocode/search?q=souk&country=dz,fr")"
assert_eq "400" "$GEO_HTTP" "country=dz,fr → 400 (fr contamine la liste)"
assert_eq "geo.country_not_configured" "$(jq -r '.code' <<<"$body")" "code geo.country_not_configured"

# ── Forme invalide → geo.invalid_query, pas country_not_configured ───────
body="$(geo_get "/v1/geocode/search?q=souk&country=FRANCE")"
assert_eq "400" "$GEO_HTTP" "country=FRANCE → 400"
assert_eq "geo.invalid_query" "$(jq -r '.code' <<<"$body")" "forme invalide distinguée du pays non configuré"

summary
