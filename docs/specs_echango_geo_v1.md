# Specs — echango-geo v1 (service de géolocalisation transverse)

**Statut** : spec, rien d'implémenté. Destiné à être donné tel quel à Claude
Code pour le développement.
**Date** : 05/09/2026.
**Origine** : revue transverse menée sur `echango-delivery`, `echangoorder`,
`echangopromo` et `crm` (session du 05/09/2026) — voir §1 pour les preuves
précises, fichier par fichier.

---

## 1. Contexte et pourquoi ce dépôt existe

### 1.1 La preuve : deux implémentations Nominatim indépendantes, déjà écrites

| | `echango-delivery/backend/bff/src/common/geocoding/geocoding.service.ts` | `crm/addons/echango_promo_crm/models/echango_promo_geocodage.py` |
|---|---|---|
| langage | TypeScript / NestJS | Python / Odoo |
| capacité | recherche + inverse | inverse seul |
| throttle | 1100 ms | 1200 ms |
| gestion du 429 | absente | `QuotaNominatimDepasse`, arrêt du lot |
| erreur transitoire ≠ terminale | absente | oui — 61 fiches perdues avant correction |
| adresse Nominatim incohérente selon le pays | décomposition `GeocodedPlace` (rue/quartier/commune/wilaya) | table d'alias DZ/AE écrite à la main |
| `User-Agent` requis par la politique d'usage | oui | oui |
| seuil anti-sur-géocodage | — | 200 m de dérive avant nouvel appel |

Deux équipes/passages ont payé séparément le même prix d'apprentissage
(bannissement IP évité de justesse des deux côtés, distinction succès-vide vs
échec réseau redécouverte deux fois). `echangopromo`, qui a **explicitement
refusé** le géocodage dans son propre backend (`docs/PLAN_BASCULE_GEO.md`,
décision 6 : « pas de géocodeur, ni direct ni inverse »), en a quand même
besoin **ailleurs** dans le même écosystème (`crm`, pour la même donnée
commerçant) — preuve que le besoin ne disparaît pas, il se déplace.

### 1.2 Principe directeur — à appliquer à toute capacité future

**La question qui décide si quelque chose entre dans ce service n'est jamais
« est-ce un calcul géographique », mais « qui possède la donnée interrogée ».**

| | donnée interrogée | qui la possède | où vit le calcul |
|---|---|---|---|
| Géocodage (adresse ↔ point) | réseau OSM | personne — référentiel public partagé | **ici** |
| Itinéraire / distance routière | réseau routier OSM | personne — référentiel public partagé | **ici** |
| Rayon autour des commerçants d'`echangopromo` | table `commercant` | `echangopromo` | **chez eux**, avec leur index GiST |
| Filtre de proximité des transporteurs disponibles | état « en ligne » Fleetbase | `echango-delivery` | **chez eux** (`driver-zone.ts`) |

Un référentiel géographique statique et partagé (adresses, réseau routier)
n'appartient à aucun produit : il vit ici. Une donnée produit vivante
(commerçants, transporteurs) reste avec son propriétaire et son index — la
sortir vers ce service imposerait un aller-retour réseau et jetterait un
index déjà construit pour l'éviter (mesure `echangopromo` : 53 lignes
remontées via GiST contre 101 sans lui).

**Confirmation apportée le 05/09/2026** : `docs/specs_localisation_client_et_
optimisation_parcours.md` §2.5 (côté `echango-delivery`) spécifie une
fonctionnalité qui *ressemble* à un besoin de routage (« optimisation de
parcours conducteur ») et tranche explicitement : elle réutilise
`distanceKm()` (haversine, local) et **n'a besoin d'aucun moteur de
routage**. Ce n'est donc pas un consommateur de ce service — exemple concret
de la frontière du §1.2 appliquée avant même que ce dépôt existe.

### 1.3 Ce que ce service est — et n'est pas

**Est** : une façade HTTP stateless devant des moteurs géographiques
auto-hébergés (Nominatim, puis OSRM), appelée par les backends des produits
— jamais directement par une app mobile.

**N'est pas** : un entrepôt de données produit, un moteur de recherche de
proximité sur des données commerçant/transporteur, un service d'autorisation
ou d'authentification de personas.

---

## 2. Capacités v1 — géocodage

### 2.1 `GET /v1/geocode/search`

Recherche d'adresse à partir d'un texte libre. Reprend tel quel le contrat
déjà éprouvé de `GeocodeQueryDto`/`GeocodedPlace` d'`echango-delivery`.

**Requête**

| paramètre | type | requis | contrainte |
|---|---|---|---|
| `q` | string | oui | 3–200 caractères (sous 3, Nominatim renvoie du bruit — `echango-delivery` l'a déjà appliqué) |
| `country` | string | non | code ISO-2 minuscule, ou liste séparée par virgules (`dz`, `dz,ae`) ; défaut = `GEO_DEFAULT_COUNTRIES` |
| `limit` | int | non | 1–10, défaut 5 |

**Réponse `200`** — tableau de `Place` (0 à `limit` éléments, jamais d'erreur
sur « rien trouvé ») :

```jsonc
{
  "results": [
    {
      "label": "Rue Larbi Tebessi, Ali Mellah, Belcourt, Alger, ...",
      "shortLabel": "Rue Larbi Tebessi",
      "latitude": 36.7538,
      "longitude": 3.0588,
      "street": "Rue Larbi Tebessi",
      "neighborhood": "Ali Mellah",
      "district": "Belcourt",
      "city": "Alger",
      "province": "Alger",
      "postalCode": "16000",
      "country": "DZ"
    }
  ]
}
```

Champs identiques à l'interface `GeocodedPlace` actuelle
(`echango-delivery`), décomposition Nominatim comprise (numéro+rue joints
dans l'ordre français, repli quartier/secteur quand pas de voie nommée,
`country` en code ISO-2 majuscule et non en nom de pays).

### 2.2 `GET /v1/geocode/reverse`

Adresse correspondant à un point.

**Requête** : `lat` (`@IsLatitude`), `lon` (`@IsLongitude`) — mêmes
contraintes que `ReverseGeocodeQueryDto` actuel.

**Réponse `200`** — un seul `Place`. **Ne lève jamais** si Nominatim ne
connaît pas le point (mer, zone non cartographiée) : rend les coordonnées
telles quelles avec les champs texte vides — comportement déjà décidé et
correct dans `echango-delivery`, à conserver à l'identique (« le point reste
valide, c'est le libellé qui manque »).

### 2.3 Contrat d'erreur

Registre propre à ce service, namespace `geo.*`, même discipline que
`error-codes.ts`/`http-errors.ts` d'`echango-delivery` (code stable + message,
jamais un throw nu) :

| code | HTTP | quand |
|---|---|---|
| `geo.invalid_query` | 400 | DTO invalide (déjà couvert par le `ValidationPipe`, whitelist + forbidNonWhitelisted) |
| `geo.upstream_unavailable` | **503** | Nominatim injoignable ou timeout — requête du client valide, c'est l'amont qui manque |
| `geo.upstream_rate_limited` | **503** | Nominatim répond 429 (ne devrait plus arriver en self-hosted, mais le code doit exister — voir §7.3) |
| `geo.country_not_configured` | 400 | `country` demandé hors de `GEO_SUPPORTED_COUNTRIES` (§6.3) |

⚠️ **503 et non 400 pour les deux premiers**, exactement le motif déjà écrit
dans `http-errors.ts` d'`echango-delivery` : un 4xx dit « ta requête est
fautive » et invite à ne pas réessayer, ce qui est faux ici. Reprendre
`serviceUnavailable(code, message)` tel quel.

### 2.4 Débit et abus

Le throttle de 1,1 s n'a plus de raison d'être une fois Nominatim
self-hosté (§4) — c'était une contrainte de la politique d'usage de
l'instance **publique**, pas une limite technique de Nominatim lui-même.
Le remplacer par un `@Throttle` NestJS ordinaire (protection contre une
boucle cliente, pas contre notre propre instance), valeur à définir en
config (§6.3), défaut proposé **20 req/s par IP appelante**.

---

## 3. Capacités v2 — routage (design maintenant, build plus tard)

**Ne pas implémenter en v1.** Cette section fige le contrat pour que
l'ajouter plus tard soit « brancher un conteneur de plus », pas « repenser
l'API ». Aucun produit n'en a besoin aujourd'hui — `docs/specs_localisation_
client_et_optimisation_parcours.md` le confirme explicitement (§1.2).

### 3.1 `GET /v1/route/directions`

Itinéraire point à point. `from=lat,lon`, `to=lat,lon`, `waypoints=lat,lon;...`
optionnel. Réponse : distance (m), durée (s), géométrie encodée (polyline).

### 3.2 `POST /v1/route/table`

Matrice de distances/durées entre N points — l'entrée dont un solveur de
tournée a besoin. Corps : `points: [{lat, lon}]`. Réponse : matrices
`distances[i][j]`, `durations[i][j]`.

### 3.3 `POST /v1/route/optimize` — **hors v2 par défaut**

Ordre de visite optimal pour N arrêts. À n'ouvrir que si un produit exprime
un vrai besoin de tournée multi-arrêts (aucun aujourd'hui — le §2.6 de
`docs/specs_localisation_client_et_optimisation_parcours.md` distingue déjà
explicitement « suggestion à la volée » de « tournée planifiée façon flotte
dédiée », et seule la première est spécifiée côté produit).

### 3.4 Moteur

**OSRM** pour 3.1/3.2 quand le besoin arrive (rapide, table de distances
native). **Valhalla** seulement si 3.3 s'ouvre un jour (solveur de tournée
intégré, `optimized_route`) — ne pas installer les deux sans raison.

---

## 4. Ce qui reste explicitement hors de ce service

- **Recherche de proximité/rayon sur des données produit** (§1.2). Aucune
  route de ce type ici, jamais. Un futur consommateur qui en aurait besoin
  construit son propre index à côté de sa donnée.
- **Résolution vers un référentiel interne** (ex. `res.country.state`
  Odoo). `crm` garde sa table d'alias DZ/AE et son appariement — ce service
  rend un nom de wilaya en texte propre, jamais un identifiant d'une base
  tierce qu'il ne connaît pas.
- **Tuiles cartographiques.** `flutter_map` pointe directement sur
  `tile.openstreetmap.org` depuis les apps aujourd'hui (`echango-delivery`,
  `echangopromo`) — ce n'est pas un problème pour ce service v1, mais un
  candidat noté en §9 si le volume dépasse un jour la politique d'usage OSM.

---

## 5. Architecture applicative

NestJS — même stack que `echango-delivery` et `echangopromo`, pour que
l'équipe qui maintient les trois retrouve les mêmes réflexes.

```
src/
  geocode/
    geocode.controller.ts
    geocode.service.ts        # logique métier, appelle nominatim.client.ts
    nominatim.client.ts       # HTTP vers le conteneur Nominatim interne
    dto/
      geocode-search.dto.ts   # ex-GeocodeQueryDto + `country`, `limit`
      geocode-reverse.dto.ts  # ex-ReverseGeocodeQueryDto
    geocode.module.ts
  common/
    errors/
      error-codes.ts          # registre `geo.*`, même forme que celui d'echango-delivery
      http-errors.ts          # badRequest/serviceUnavailable, copie du patron existant
    config/
      geo-config.service.ts   # lecture typée des env vars, cf. §6.3
  health/
    health.controller.ts
  app.module.ts
```

Réutiliser **verbatim** la forme de `GeocodedPlace` et de son mapping
Nominatim (`toPlace()`) depuis `echango-delivery/backend/bff/src/common/
geocoding/geocoding.service.ts` — ce code est déjà écrit, déjà éprouvé sur
des adresses algériennes réelles (30/07/2026). Le déplacer, ne pas le
réécrire.

### 5.1 Health

Même discipline que `echango-delivery/backend/bff/src/health/health.
controller.ts` : `/health` **ne lève jamais** sur l'état des moteurs
internes, il le **rapporte**.

```jsonc
{
  "status": "ok",
  "timestamp": "...",
  "dependencies": {
    "nominatim": { "reachable": true },
    "osrm": { "reachable": null }   // null = pas encore déployé (v1), pas une panne
  }
}
```

⚠️ Nuance par rapport au patron `echango-delivery` : là-bas Fleetbase est un
tiers dont la panne dégrade sans bloquer. Ici, Nominatim est **le** moteur
que ce service expose — si `nominatim.reachable` est `false`, le service ne
peut plus rendre les routes de §2 (elles répondent `503`, §2.3), mais
`/health` reste `200` avec l'info dedans : c'est à l'orchestrateur/à la
supervision de décider quoi faire de `reachable: false`, pas au conteneur de
se tuer pour une dépendance qu'un redémarrage ne répare pas.

---

## 6. Moteurs et données

### 6.1 Nominatim self-hosté

Image `mediagis/nominatim` (embarque son propre Postgres/PostGIS interne —
**distinct** de toute base applicative, aucun partage avec Fleetbase, le
BFF Delivery ou `echangopromo`).

### 6.2 Geofabrik — ce qu'il apporte concrètement ici

Nominatim a besoin d'un extrait OSM à importer. Geofabrik publie des
**extraits par pays**, mis à jour quotidiennement, au lieu de la planète
entière (des centaines de Go, hors de propos pour un produit scopé
Algérie/Émirats) :

- import initial : `https://download.geofabrik.de/africa/algeria-latest.osm.pbf`
  (~quelques centaines de Mo), et l'extrait couvrant les Émirats (préciser
  la région Geofabrik exacte au moment de l'implémentation — `crm` a déjà
  besoin d'AE, cf. §1.1) ;
- rafraîchissement périodique nécessaire (OSM change en continu) — un job
  planifié (cron mensuel proposé, à ajuster) qui retélécharge et réimporte,
  ou applique les diffs Geofabrik si le volume le justifie plus tard ;
- **une fois importé, plus aucun appel réseau public au moment de la
  requête** — élimine le risque de bannissement IP que les deux
  implémentations actuelles (§1.1) ont dû gérer à la main.

### 6.3 Configuration — env vars, rien en dur

| clé | rôle | défaut |
|---|---|---|
| `GEO_DEFAULT_COUNTRIES` | pays utilisés si `country` absent de la requête | `dz` |
| `GEO_SUPPORTED_COUNTRIES` | liste fermée des extraits réellement importés | `dz,ae` |
| `NOMINATIM_INTERNAL_URL` | URL du conteneur Nominatim sur le réseau interne | `http://geo-nominatim:8080` |
| `GEO_RATE_LIMIT_PER_IP` | requêtes/s autorisées par appelant | `20` |
| `GEO_HTTP_TIMEOUT_MS` | délai avant `geo.upstream_unavailable` | `10000` |

Lecture typée avec un garde-fou du même esprit que `configNumber()`
d'`echangopromo` (repli journalisé sur une valeur illisible ou hors borne,
jamais un plantage au démarrage pour une faute de frappe de `.env`) — à
adapter ici plutôt qu'à importer tel quel, les deux dépôts restant
indépendants.

**`GEO_SUPPORTED_COUNTRIES` n'est pas cosmétique** : une requête avec
`country=fr` doit être refusée en `geo.country_not_configured` plutôt que de
silencieusement chercher dans un extrait qui n'existe pas (Nominatim
répondrait alors "sans résultat", indiscernable d'une adresse inconnue —
règle 10 de l'écosystème : une absence de configuration ne doit pas se
déguiser en absence de résultat).

---

## 7. Déploiement

Suit le patron déjà rodé sur le VPS (`echangopromo/docker-compose.promo.yml`) :
réseau Docker externe partagé `echango_network`, Traefik pour ce qui doit
être joignable depuis l'extérieur.

### 7.1 Ce service n'a **pas** de routeur Traefik public

Seuls des backends (autres conteneurs sur `echango_network`) l'appellent —
jamais une app mobile. La frontière d'accès est le réseau Docker lui-même :
non exposé publiquement, injoignable depuis l'extérieur par construction.
Défense en profondeur optionnelle : un en-tête de jeton partagé
(`X-Internal-Token`), à trancher en §10.

### 7.2 Squelette Compose

```yaml
name: echango-geo   # explicite — la collision de nom de projet a déjà
                     # corrompu une base de prod chez echangopromo (voir
                     # leur docs/status_v0.md), ne pas répéter l'erreur.

services:
  geo-api:
    build: ./apps/api
    restart: unless-stopped
    depends_on:
      geo-nominatim:
        condition: service_healthy
    env_file: [.env.production]
    networks: [echango_network]
    # Pas de `ports:` publié côté hôte, pas de labels Traefik — voir §7.1.

  geo-nominatim:
    image: mediagis/nominatim:4.5
    restart: unless-stopped
    environment:
      PBF_URL: https://download.geofabrik.de/africa/algeria-latest.osm.pbf
      REPLICATION_URL: https://download.geofabrik.de/africa/algeria-updates/
    volumes:
      - nominatim_data:/var/lib/postgresql/14/main
    networks: [echango_network]
    healthcheck:
      test: ['CMD-SHELL', 'curl -sf http://localhost:8080/status.php || exit 1']
      interval: 30s
      timeout: 10s
      retries: 10

networks:
  echango_network:
    external: true

volumes:
  nominatim_data:
```

Noms de service **non génériques** (`geo-nominatim`, pas `postgres` ni
`nominatim`) — la leçon `echangopromo` (deux stacks avec un service
`postgres` identique sur le même réseau externe, résolution DNS croisée,
incident de prod réel) s'applique mot pour mot ici.

---

## 8. Migration des consommateurs existants

### 8.1 `echango-delivery`

`GeocodingService` (BFF) devient un client HTTP vers
`GEO_SERVICE_URL/v1/geocode/*` au lieu d'appeler Nominatim directement.
**Le contrat `GeocodedPlace` ne change pas** — aucun écran, aucun DTO
consommateur (`geocode.dto.ts`) n'a besoin d'être touché. Le throttle
1100 ms interne disparaît (il vivait dans le client Nominatim direct,
plus nécessaire une fois derrière ce service).

### 8.2 `crm`

`_interroger_nominatim` (46 lignes : construction requête, `User-Agent`,
gestion 429) devient un appel HTTP de quelques lignes vers
`GET /v1/geocode/reverse`. `_etat_correspondant` et la table `ALIAS_ETATS`
restent **inchangés** dans `crm` — spécifiques à `res.country.state` Odoo,
hors périmètre de ce service (§4).

### 8.3 `echangopromo`

Aucun changement requis maintenant — disponible le jour où la décision
« pas de géocodeur » (`PLAN_BASCULE_GEO.md` décision 6) est rouverte.

---

## 9. Bancs de vérification à prévoir

Même culture que les trois autres dépôts (`scripts/test-*.sh`, éprouvés par
mutation, jamais seulement par un cas qui passe) :

- `test-geocode-search.sh` — une adresse connue rend un `Place` décomposé
  correctement (rue/quartier/commune/wilaya) ;
- `test-geocode-reverse.sh` — un point en mer rend des coordonnées et des
  champs texte vides, **pas** une erreur ;
- `test-pays-restriction.sh` — `country=fr` (non supporté) refusé en
  `geo.country_not_configured`, jamais une recherche silencieuse dans le
  vide ;
- `test-panne-nominatim.sh` — conteneur Nominatim coupé délibérément :
  `/v1/geocode/*` rend `503`/`geo.upstream_unavailable`, jamais `400` ;
  `/health` reste `200` avec `nominatim.reachable: false` ;
- `test-debit.sh` — dépassement du quota par IP refusé proprement, sans
  faire tomber le service pour les autres appelants.

---

## 10. Décisions ouvertes à trancher avant le développement

- **Authentification interne** : réseau Docker fermé seul, ou en plus un
  jeton partagé en en-tête ? Recommandation : réseau fermé en v1 (§7.1),
  jeton ajoutable sans casser le contrat si un jour un consommateur externe
  au réseau `echango_network` apparaît.
- **Extrait Geofabrik pour les Émirats** : région exacte à confirmer
  (`middle-east` sur Geofabrik couvre plusieurs pays — vérifier la taille
  avant de l'importer en entier si seul AE est nécessaire).
- **Cadence de rafraîchissement** de l'extrait Nominatim — mensuel proposé
  en §6.2, à confirmer selon le taux de correction d'adresses observé.
- **Cache de résultats de géocodage** entre produits (une même adresse
  recherchée par deux commerçants de deux produits différents) — non
  spécifié ici, gain incertain tant que Nominatim est local et rapide ; à
  mesurer avant de construire.

---

## 11. Roadmap explicitement différée (ne pas construire maintenant)

- Routage/distance réelle et matrice (§3.1–3.2) — quand un produit en
  exprime le besoin.
- Optimisation de tournée (§3.3) — seulement si un produit planifie de
  vraies tournées multi-arrêts, pas la suggestion à la volée déjà
  spécifiée côté `echango-delivery`.
- Tuiles auto-hébergées (OpenMapTiles/TileServer GL) — si le volume dépasse
  la politique d'usage raisonnable de `tile.openstreetmap.org`.
