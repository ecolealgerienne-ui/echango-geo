#!/usr/bin/env bash
# Fonctions communes aux bancs. Sourcé, jamais exécuté seul.
#
# Convention (même culture que les trois autres dépôts) : un banc ne se
# contente pas d'un cas qui passe, il prouve d'abord que sa chaîne de mesure
# fonctionne (le « témoin »), puis vérifie le comportement ET le défaut qu'il
# garde. Sortie non nulle au premier échec.

set -euo pipefail

GEO_BASE_URL="${GEO_BASE_URL:-http://localhost:3000}"
GEO_INTERNAL_TOKEN="${GEO_INTERNAL_TOKEN:-}"

if [[ -z "$GEO_INTERNAL_TOKEN" ]]; then
  echo "FATAL: GEO_INTERNAL_TOKEN non défini — les routes /v1/* refuseront tout." >&2
  exit 2
fi

command -v jq  >/dev/null || { echo "FATAL: jq requis" >&2; exit 2; }
command -v curl >/dev/null || { echo "FATAL: curl requis" >&2; exit 2; }

_pass=0
_fail=0

# Remplies par geo_get / geo_raw. Déclarées ici pour `set -u`.
GEO_HTTP=""
GEO_BODY=""

# geo_get <chemin> [args curl...] — avec le jeton interne.
# Écrit le corps dans GEO_BODY et le code HTTP dans GEO_HTTP.
# ⚠️ Appeler directement (`geo_get /x`), PAS via $(...) : une substitution de
# commande s'exécute dans un sous-shell et les variables n'en sortiraient pas.
geo_get() {
  local path="$1"; shift
  _geo_call -H "X-Internal-Token: ${GEO_INTERNAL_TOKEN}" "$@" "${GEO_BASE_URL}${path}"
}

# geo_raw <chemin> [args curl...] — SANS jeton (test du guard, /health).
geo_raw() {
  local path="$1"; shift
  _geo_call "$@" "${GEO_BASE_URL}${path}"
}

_geo_call() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' "$@")"
  GEO_HTTP="${resp##*$'\n'}"
  GEO_BODY="${resp%$'\n'*}"
}

# jget <filtre jq> — interroge GEO_BODY.
jget() { jq -r "$1" <<<"$GEO_BODY"; }

ok() { _pass=$((_pass+1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
ko() { _fail=$((_fail+1)); printf '  \033[31mKO\033[0m   %s\n' "$1"; }

assert_eq() { # <attendu> <obtenu> <libellé>
  if [[ "$1" == "$2" ]]; then ok "$3"; else ko "$3 — attendu [$1], obtenu [$2]"; fi
}
assert_ne() { # <interdit> <obtenu> <libellé>
  if [[ "$1" != "$2" ]]; then ok "$3"; else ko "$3 — valeur interdite [$1]"; fi
}
assert_nonempty() { # <valeur> <libellé>
  if [[ -n "$1" && "$1" != "null" ]]; then ok "$2"; else ko "$2 — vide"; fi
}
assert_empty() { # <valeur> <libellé>
  if [[ -z "$1" || "$1" == "null" ]]; then ok "$2"; else ko "$2 — non vide [$1]"; fi
}

summary() {
  echo
  printf 'Total : %d ok, %d KO\n' "$_pass" "$_fail"
  [[ "$_fail" -eq 0 ]] || exit 1
}
