# echango-geo

Service transverse de géolocalisation pour l'écosystème Echango
(`echango-delivery`, `echangoorder`, `echangopromo`, `crm`, et les projets à
venir) : géocodage (adresse ↔ point), et plus tard itinéraire/distance
routière.

Auto-hébergé, par-dessus OpenStreetMap (Nominatim, puis OSRM/Valhalla si
besoin) — aucune clé API tierce, pas de facturation au volume.

**Statut : v1 (géocodage) implémentée.** Voir
[`docs/specs_echango_geo_v1.md`](docs/specs_echango_geo_v1.md) pour le
contrat détaillé, l'architecture, le plan de déploiement et la migration des
consommateurs existants.

Ce que ce service **n'est pas** : un entrepôt de données produit, ni un
moteur de recherche de proximité sur des données commerçant/transporteur —
voir §1.2 et §4 des specs pour le principe qui tranche.

---

## API v1

Toutes les routes `/v1/*` exigent l'en-tête `X-Internal-Token`
(défense en profondeur derrière la frontière réseau Docker, §7.1). `/health`
en est exempté.

| route | rôle |
|---|---|
| `GET /v1/geocode/search?q=&country=&limit=` | texte libre → 0..N `Place` décomposés |
| `GET /v1/geocode/reverse?lat=&lon=` | point → un `Place` (jamais d'erreur sur un point inconnu) |
| `GET /health` | `status: ok` + `dependencies.nominatim.reachable` — ne lève jamais |

Contrat d'erreur (namespace `geo.*`) : `geo.invalid_query` (400),
`geo.country_not_configured` (400), `geo.upstream_unavailable` (503),
`geo.upstream_rate_limited` (503), `geo.unauthorized` (401).

## Développement

```bash
cd apps/api
npm install
cp .env.example .env          # renseigner au minimum GEO_INTERNAL_TOKEN
npm run start:dev
npm test                      # tests unitaires
```

Sans conteneur Nominatim en face, `/v1/geocode/*` répond `503`
`geo.upstream_unavailable` (attendu) ; `/health` reste `200` avec
`nominatim.reachable: false`.

## Déploiement (VPS)

```bash
cp .env.production.example .env.production   # renseigner les secrets
docker compose --env-file .env.production -f docker-compose.yml up -d
```

Le premier démarrage importe l'extrait Geofabrik dans Nominatim (plusieurs
minutes) ; `geo-api` attend `geo-nominatim` sain avant de démarrer.

## Bancs de vérification

`scripts/test-*.sh` — chacun prouve d'abord que sa chaîne de mesure
fonctionne (le « témoin ») avant de vérifier le comportement attendu **et**
le défaut qu'il garde :

| script | vérifie |
|---|---|
| `test-geocode-search.sh` | adresse connue → `Place` décomposé ; requête absurde → `[]`, pas une erreur |
| `test-geocode-reverse.sh` | point en mer → coordonnées + champs vides, `200` |
| `test-pays-restriction.sh` | `country=fr` → `geo.country_not_configured`, jamais une recherche vide |
| `test-panne-nominatim.sh` | Nominatim coupé → `503` (jamais `400`) ; `/health` `200` + `reachable: false` |
| `test-debit.sh` | rafale > quota → `429`, sans faire tomber le service |

Variables : `GEO_BASE_URL` (défaut `http://localhost:3000`),
`GEO_INTERNAL_TOKEN` (requis).
