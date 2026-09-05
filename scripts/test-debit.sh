#!/usr/bin/env bash
# §9 — dépassement du quota par IP refusé proprement (429), sans faire tomber
# le service pour les autres appelants.
cd "$(dirname "$0")"
source ./_lib.sh

LIMITE="${GEO_RATE_LIMIT_PER_IP:-20}"
RAFALE="${RAFALE:-$((LIMITE * 3))}"

echo "== test-debit (limite ${LIMITE}/s, rafale ${RAFALE}) =="

# ── Témoin : à rythme lent, tout passe ────────────────────────────────
n_ok=0
for _ in 1 2 3; do
  geo_get "/v1/geocode/search?q=alger&country=dz"
  [[ "$GEO_HTTP" == "200" ]] && n_ok=$((n_ok+1))
  sleep 0.5
done
assert_eq "3" "$n_ok" "témoin : 3 requêtes espacées → 3× 200"

# ── Rafale : une partie doit être refusée en 429 ──────────────────────
codes_file="$(mktemp)"
for _ in $(seq 1 "$RAFALE"); do
  curl -sS -o /dev/null -w '%{http_code}\n' \
    -H "X-Internal-Token: ${GEO_INTERNAL_TOKEN}" \
    "${GEO_BASE_URL}/v1/geocode/search?q=alger&country=dz" >>"$codes_file" &
done
wait

n_200="$(grep -c '^200$' "$codes_file" || true)"
n_429="$(grep -c '^429$' "$codes_file" || true)"
n_autre="$(grep -Evc '^(200|429)$' "$codes_file" || true)"
rm -f "$codes_file"
echo "  → 200:${n_200}  429:${n_429}  autres:${n_autre}"

awk -v x="$n_429" 'BEGIN{exit !(x>0)}'  && ok "au moins une requête refusée en 429" || ko "aucune 429 — le quota ne mord pas"
awk -v x="$n_200" 'BEGIN{exit !(x>0)}'  && ok "le service continue de répondre 200 pendant la rafale" || ko "toutes les requêtes ont échoué — le quota fait tomber le service"
assert_eq "0" "$n_autre" "aucun code inattendu (pas de 5xx sous la rafale)"

# ── Après la rafale, le service revient ───────────────────────────────
sleep 1.5
geo_get "/v1/geocode/search?q=alger&country=dz"
assert_eq "200" "$GEO_HTTP" "le quota se recharge : 200 après la fenêtre"

summary
