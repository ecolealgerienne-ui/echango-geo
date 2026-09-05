# Déploiement echango-geo sur le VPS

Stack : `geo-api` (façade HTTP NestJS) + `geo-nominatim` (Nominatim
auto-hébergé, image `mediagis/nominatim:4.5`). Calquée sur le patron
`echangopromo/docker-compose.promo.yml`, avec **deux différences** :

- **aucun routeur Traefik, aucun port publié** — ce service n'est appelé que
  par d'autres backends sur `echango_network`, jamais depuis l'extérieur
  (§7.1 des specs). La frontière d'accès est le réseau Docker + le jeton
  `X-Internal-Token` ;
- **`geo-nominatim` reste sur le réseau `internal` seul** — les backends
  consommateurs passent par `geo-api`, jamais par Nominatim directement.

---

## Prérequis sur le VPS

```bash
# Le réseau externe partagé doit déjà exister (stack principale du VPS
# démarrée au moins une fois) — sinon `up` échoue sur un réseau introuvable.
docker network ls | grep echango_network

# Espace disque : l'import de l'extrait Algérie occupe ~2–3 Go pendant
# l'import, ~1 Go une fois posé. Prévoir large sur le volume Docker.
df -h /var/lib/docker
```

---

## Premier déploiement

```bash
cd /opt/echango-geo
git clone <repo> .            # ou git pull si déjà cloné

# Fichier d'env réel, jamais commité (gitignoré) — un seul fichier, à la
# fois lu par `docker compose --env-file` (substitution ${...} dans
# docker-compose.prod.yml) et injecté dans geo-api (env_file) :
cp .env.production.example .env.production
```

Éditer `.env.production` :

| clé | valeur |
|---|---|
| `GEO_INTERNAL_TOKEN` | `openssl rand -hex 32` — **la même valeur** que dans les `.env.production` d'`echango-delivery` et d'`echangopromo` |
| `NOMINATIM_DB_PASSWORD` | mot de passe alphanumérique pour le Postgres interne à l'image Nominatim |
| `GEO_SUPPORTED_COUNTRIES` | `dz` (les Émirats sont écartés, §10) |

Puis :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

### L'import initial — **long, à laisser finir**

Au premier démarrage, `geo-nominatim` télécharge l'extrait Geofabrik
(`algeria-latest.osm.pbf`) et l'importe. Compter **20 à 45 min** selon le
VPS. `geo-api` **attend** que `geo-nominatim` soit `service_healthy` avant de
démarrer — c'est normal qu'il n'apparaisse pas tout de suite.

```bash
# Suivre l'import
docker compose --env-file .env.production -f docker-compose.prod.yml \
  logs -f geo-nominatim
# … jusqu'à « Nominatim is ready to accept requests »

docker compose --env-file .env.production -f docker-compose.prod.yml ps
# geo-nominatim : healthy   |   geo-api : Up (healthy)
```

---

## Réplication OSM — à armer une fois, après l'import

Geofabrik publie un diff par jour. `nominatim replication` les applique en
continu, sans interruption de service — pas de re-import mensuel (§10).

`nominatim replication --init` **n'est pas à faire à la main** : l'image
`mediagis/nominatim:4.5` l'exécute au premier démarrage quand `REPLICATION_URL`
est défini (log `Initialising replication updates` / `Updates initialised at
sequence …`).

```bash
# 1. Purger le retard accumulé depuis la date de l'extrait importé (--catch-up
#    applique TOUS les diffs disponibles d'un coup). Optionnel — sans impact
#    sur la précision, mais évite plusieurs jours de rattrapage horaire.
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T geo-nominatim sudo -u nominatim nominatim replication --catch-up --project-dir /nominatim

# 2. Cron — `scripts/refresh-osm.sh` fait un `replication --once` par passage.
#    ⚠️ Il parle au démon Docker : le mettre dans la crontab de ROOT (l'user
#    `ubuntu` n'est pas dans le groupe `docker`), ou `usermod -aG docker ubuntu`.
sudo crontab -e
# y ajouter :
#   0 * * * * cd /opt/echango-geo && ./scripts/refresh-osm.sh >> /var/log/echango-geo-osm.log 2>&1
```

---

## Vérification

```bash
# 1. /health depuis l'intérieur (route publique, sans jeton)
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T geo-api node -e "fetch('http://localhost:3000/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
# → {"status":"ok","dependencies":{"nominatim":{"reachable":true}, ...}}

# 2. Une vraie requête géocodée, avec le jeton, depuis geo-api lui-même
#    (avant qu'un consommateur soit déployé) :
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T geo-api \
  sh -c 'node -e "fetch(\"http://localhost:3000/v1/geocode/search?q=Alger&country=dz&limit=1\",{headers:{\"X-Internal-Token\":process.env.GEO_INTERNAL_TOKEN}}).then(r=>r.text()).then(console.log)"'
# → {"results":[{"label":"Alger, …","city":"Alger","country":"DZ", …}]}

# 3. Plus tard, depuis un backend consommateur attaché à echango_network :
docker exec <conteneur-backend> node -e "
  fetch('http://geo-api:3000/v1/geocode/search?q=Alger&country=dz&limit=1', {
    headers: { 'X-Internal-Token': process.env.GEO_INTERNAL_TOKEN }
  }).then(r=>r.text()).then(console.log)"
# → {"results":[{"label":"Alger, …","city":"Alger","country":"DZ", …}]}

# 3. Sans jeton → 401 geo.unauthorized (preuve que le guard mord)
```

---

## Redéploiement (mise à jour du code)

```bash
cd /opt/echango-geo && git pull
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --build geo-api
```

L'import Nominatim **ne se refait pas** : le volume `nominatim_data` persiste.
Seul `geo-api` est reconstruit et redémarré (quelques secondes).

Pour forcer un re-import complet (rare — changement d'extrait, corruption) :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
docker volume rm echango-geo-prod_nominatim_data
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

---

## Coordination avec les consommateurs

`echango-delivery` (BFF) et `echangopromo` (backend) appellent
`http://geo-api:3000` sur `echango_network`. Chacun doit avoir, dans **son**
`.env.production` :

```
GEO_SERVICE_URL=http://geo-api:3000
GEO_INTERNAL_TOKEN=<exactement la même valeur que côté echango-geo>
```

⚠️ **Ordre inter-dépôts** : le module Odoo `echango_promo_crm` `19.0.1.2.0`
doit être déployé **avant ou avec** le backend `echangopromo` (le backend
envoie désormais `ville`/`wilaya`/`geocodage_statut` au CRM, que l'ancien
module rejetterait). echango-geo lui-même n'a pas de dépendance d'ordre.

---

## Différence avec `docker-compose.yml` (dev local)

| | `docker-compose.yml` (local) | `docker-compose.prod.yml` (VPS) |
|---|---|---|
| `name:` | `echango-geo-local` | `echango-geo-prod` |
| réseau | bridge `geo` autonome | `internal` + `echango_network` externe |
| ports hôte | `geo-api:3000`, `nominatim:8088` publiés | aucun |
| env | `.env` (valeurs de dev) | `.env.production` |
| `geo-nominatim` | joignable depuis l'hôte (debug) | `internal` seul |
