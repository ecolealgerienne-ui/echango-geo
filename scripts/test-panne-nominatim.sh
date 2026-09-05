#!/usr/bin/env bash
# §9 — conteneur Nominatim coupé délibérément :
#   /v1/geocode/* rend 503 / geo.upstream_unavailable, jamais 400 ;
#   /health reste 200 avec nominatim.reachable: false.
#
# Ce banc MANIPULE la stack (docker compose stop/start). À lancer sur un
# environnement jetable (stack locale), pas en prod.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
source ./_lib.sh

# Les opérations compose se font depuis la racine du dépôt (docker-compose.yml).
REPO_ROOT="$(cd "$here/.." && pwd)"
COMPOSE=(${COMPOSE:-docker compose} --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml")
NOMINATIM_SVC="${NOMINATIM_SVC:-geo-nominatim}"

command -v docker >/dev/null || { echo "FATAL: docker requis pour ce banc" >&2; exit 2; }

echo "== test-panne-nominatim =="

# ── Témoin : la chaîne fonctionne AVANT la coupure ──────────────────────
geo_get "/v1/geocode/search?q=alger+centre&country=dz"
assert_eq "200" "$GEO_HTTP" "témoin : search répond 200 avant coupure"

restore() {
  echo "  … redémarrage de $NOMINATIM_SVC"
  "${COMPOSE[@]}" start "$NOMINATIM_SVC" >/dev/null 2>&1 || true
}
trap restore EXIT

echo "  … arrêt de $NOMINATIM_SVC"
"${COMPOSE[@]}" stop "$NOMINATIM_SVC" >/dev/null
sleep 2   # laisse tomber les connexions en vol

# ── search : 503, jamais 400 ───────────────────────────────────────────
geo_get "/v1/geocode/search?q=alger+centre&country=dz"
assert_eq "503" "$GEO_HTTP" "search → 503 quand Nominatim est à terre"
assert_ne "400" "$GEO_HTTP" "surtout PAS 400 (la requête client est valide)"
assert_eq "geo.upstream_unavailable" "$(jget '.code')" "code geo.upstream_unavailable"

# ── reverse : 503 aussi — pas un 200 à libellé vide (sinon indiscernable
#    d'un point en mer) ────────────────────────────────────────────────
geo_get "/v1/geocode/reverse?lat=36.7538&lon=3.0588"
assert_eq "503" "$GEO_HTTP" "reverse → 503 quand Nominatim est à terre"
assert_eq "geo.upstream_unavailable" "$(jget '.code')" "code geo.upstream_unavailable"

# ── /health : 200, mais dit la vérité ─────────────────────────────────
geo_raw "/health"
assert_eq "200" "$GEO_HTTP" "/health reste 200 malgré Nominatim à terre"
assert_eq "ok" "$(jget '.status')" "/health status ok"
assert_eq "false" "$(jget '.dependencies.nominatim.reachable')" "nominatim.reachable = false"

summary
