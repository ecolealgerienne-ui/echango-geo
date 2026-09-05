#!/usr/bin/env bash
#
# Applique les diffs OSM Geofabrik au Nominatim auto-hébergé.
#
# ── Pourquoi des diffs quotidiens et pas un re-import mensuel (§10) ──────────
#
# Geofabrik publie un diff par jour pour chaque extrait. `nominatim
# replication` (fourni par l'image `mediagis/nominatim`) les télécharge et les
# applique en quelques secondes chacun — le `REPLICATION_URL` du compose est
# déjà pointé dessus. Un re-import mensuel complet couperait le service
# plusieurs minutes et perdrait un mois de corrections d'adresses entre deux
# passages ; les diffs gardent l'index frais en continu sans interruption.
#
# ── Mise en place ──────────────────────────────────────────────────────────
#
#   1. UNE fois, après l'import initial :
#        docker compose -f docker-compose.prod.yml exec -T geo-nominatim \
#          sudo -u nominatim nominatim replication --init
#   2. Puis ce script en cron hôte (toutes les heures suffit largement — un
#      diff quotidien, appliqué au prochain passage) :
#        0 * * * * /opt/echango-geo/scripts/refresh-osm.sh >> /var/log/echango-geo-osm.log 2>&1
#
# ⚠️ `--once` : applique le prochain lot de diffs disponible puis rend la main.
# Sans lui, `replication` entre dans une boucle infinie — à réserver à un
# service dédié, pas à un cron.

set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"
COMPOSE_FILE="${COMPOSE_FILE:-$(cd "$(dirname "$0")/.." && pwd)/docker-compose.prod.yml}"
SVC="${GEO_NOMINATIM_SVC:-geo-nominatim}"

$COMPOSE -f "$COMPOSE_FILE" exec -T "$SVC" \
  sudo -u nominatim nominatim replication --once --project-dir /nominatim

echo "$(date -Is) — diffs OSM appliqués"
