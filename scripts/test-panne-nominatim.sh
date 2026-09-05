#!/usr/bin/env bash
# §9 — conteneur Nominatim coupé délibérément :
#   /v1/geocode/* rend 503 / geo.upstream_unavailable, jamais 400 ;
#   /health reste 200 avec nominatim.reachable: false.
#
# Ce banc MANIPULE la stack (docker stop/start). À lancer sur un
# environnement jetable, pas en prod.
cd "$(dirname "$0")"
source ./_lib.sh

COMPOSE="${COMPOSE:-docker compose}"
NOMINATIM_SVC="${NOMINATIM_SVC:-geo-nominatim}"

command -v docker >/dev/null || { echo "FATAL: docker requis pour ce banc" >&2; exit 2; }

echo "== test-panne-nominatim =="

# ── Témoin : la chaîne fonctionne AVANT la coupure ──────────────────────
body="$(geo_get "/v1/geocode/search?q=alger+centre&country=dz")"
assert_eq "200" "$GEO_HTTP" "témoin : search répond 200 avant coupure"

restore() {
  echo "  … redémarrage de $NOMINATIM_SVC"
  $COMPOSE start "$NOMINATIM_SVC" >/dev/null 2>&1 || true
}
trap restore EXIT

echo "  … arrêt de $NOMINATIM_SVC"
$COMPOSE stop "$NOMINATIM_SVC" >/dev/null
# Laisse tomber les connexions en vol.
sleep 2

# ── search : 503, jamais 400 ───────────────────────────────────────────
body="$(geo_get "/v1/geocode/search?q=alger+centre&country=dz")"
assert_eq "503" "$GEO_HTTP" "search → 503 quand Nominatim est à terre"
assert_ne "400" "$GEO_HTTP" "surtout PAS 400 (la requête client est valide)"
assert_eq "geo.upstream_unavailable" "$(jq -r '.code' <<<"$body")" "code geo.upstream_unavailable"

# ── reverse : 503 aussi — pas un 200 à libellé vide (sinon indiscernable
#    d'un point en mer) ────────────────────────────────────────────────
body="$(geo_get "/v1/geocode/reverse?lat=36.7538&lon=3.0588")"
assert_eq "503" "$GEO_HTTP" "reverse → 503 quand Nominatim est à terre"
assert_eq "geo.upstream_unavailable" "$(jq -r '.code' <<<"$body")" "code geo.upstream_unavailable"

# ── /health : 200, mais dit la vérité ─────────────────────────────────
body="$(curl -sS -w '\n%{http_code}' "${GEO_BASE_URL}/health")"
hcode="${body##*$'\n'}"; hbody="${body%$'\n'*}"
assert_eq "200" "$hcode" "/health reste 200 malgré Nominatim à terre"
assert_eq "ok" "$(jq -r '.status' <<<"$hbody")" "/health status ok"
assert_eq "false" "$(jq -r '.dependencies.nominatim.reachable' <<<"$hbody")" "nominatim.reachable = false"

summary
