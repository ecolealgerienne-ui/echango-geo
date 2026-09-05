# Migration des consommateurs vers echango-geo — runbook

Document de reprise : à lire tel quel dans une nouvelle session ou par un·e
collègue, sans contexte préalable. Il décrit **comment brancher `echango_promo_crm`,
le backend `echangopromo` et le BFF `echango-delivery` sur le service
`echango-geo` déjà déployé**.

---

## 0. Contexte minimal

`echango-geo` est un service HTTP interne (façade NestJS devant un Nominatim
auto-hébergé) qui fait le géocodage pour tout l'écosystème. Il remplace deux
implémentations Nominatim directes qui coexistaient (le BFF delivery, le module
CRM). Specs : `docs/specs_echango_geo_v1.md`. Déploiement du service :
`docs/DEPLOIEMENT_VPS.md`.

**État au 2026-09-05** :

- `echango-geo` **déployé sur le VPS** (`/opt/echango-geo`,
  `docker-compose.prod.yml`, projet `echango-geo-prod`). Import Algérie fait,
  conteneurs `healthy`, géocodage vérifié en prod (« Rue Didouche Mourad
  Alger » → `Place` décomposé, jeton accepté).
- 3 PR ouvertes, **non mergées, non déployées** :

  | dépôt | PR | contenu | tests |
  |---|---|---|---|
  | `crm` (`echango_promo_crm`) | **#1** | module `19.0.1.2.0` — retire le géocodage Nominatim direct | ✅ 59/59 Odoo + chemin de migration validé |
  | `echangopromo` | **#33** | backend — géocode la position à la pose, cron de reprise, contrat CRM étendu | ✅ build + 12/12 geo + 85/85 commerçant + `migration:generate` vide + `check-geo-bascule` 6/6 |
  | `echango-delivery` | **#13** | BFF — `GeocodingService` devient client HTTP | ✅ build + 24 unit + `check-geo-bascule` 12/12 |

Ce runbook = la suite : merger + déployer les 3.

---

## 1. Invariants à ne jamais casser

- **`GEO_INTERNAL_TOKEN` : une seule valeur**, identique dans les
  `.env.production` de `echango-geo` (VPS), `echangopromo` et `echango-delivery`.
  Celle de référence est déjà posée sur le VPS :
  ```bash
  grep GEO_INTERNAL_TOKEN /opt/echango-geo/.env.production
  ```
- **`GEO_SERVICE_URL=http://geo-api:3000`** partout. `echango-geo` n'est
  joignable que sur le réseau Docker `echango_network`, jamais par un nom
  public. Les backends promo et delivery y sont déjà attachés.
- **Contrat `GeocodedPlace` / `ville`/`wilaya` inchangé** côté écrans. Aucune
  app mobile à retoucher (un seul commentaire Flutter, déjà commité dans #13).
- `GEO_SUPPORTED_COUNTRIES=dz` — les Émirats sont écartés (§10). `country=ae`
  est refusé franchement.

---

## 2. Ordre de déploiement — IMPÉRATIF

```
1. CRM   echango_promo_crm 19.0.1.2.0   ─┐  le module doit ACCEPTER ville/wilaya
2. Promo backend  #33                   ─┘  AVANT que le backend les ENVOIE
3. Delivery BFF  #13                        indépendant — quand tu veux
```

**Pourquoi 1 avant 2** : le backend promo #33 ajoute `ville` / `wilaya` /
`geocodage_statut` au payload de synchronisation CRM. La liste blanche
`CHAMPS_FICHE` de l'ancien module Odoo **rejette toute fiche portant un champ
inconnu** → à la synchro de 04:00, **toutes les fiches refusées**.

Si tu dois quand même déployer promo avant le CRM : **coupe le push CRM** du
backend promo (laisser `CRM_SYNC_URL` / `CRM_SYNC_TOKEN` vides dans son
`.env.production` — la tâche journalise son abstention et ne pousse rien) le
temps que le CRM passe en `19.0.1.2.0`.

**Delivery (#13) est totalement indépendant** des deux autres.

---

## 3. CRM — `echango_promo_crm` 19.0.1.2.0 (PR crm#1)

### 3.1 Ce que la PR fait

- Supprime tout le géocodage Nominatim direct : `_interroger_nominatim`,
  throttle 1 req/s, `QuotaNominatimDepasse`/429, lots de 25, seuil de dérive,
  `_cron_geocoder` / `_geocoder_lot` / `_marquer_a_geocoder`.
- `CHAMPS_FICHE` (contrôleur de synchro) accepte `ville` / `wilaya` /
  `geocodage_statut` ; `_appliquer_lieu` écrit `city` + `state_id` sur le
  partenaire Odoo quand `geocodage_statut == 'fait'`.
- Conserve `normaliser_nom_etat`, `ALIAS_ETATS`, `_etat_correspondant`
  (appariement nom de wilaya → `res.country.state` natif — spécifique Odoo).
- Migration `migrations/19.0.1.2.0/post-migration.py` : supprime le cron
  `cron_echango_promo_geocodage` en base, retire les colonnes
  `geocodage_le` / `geocodage_latitude` / `geocodage_longitude`.

### 3.2 Déployer

```bash
# 1. merger crm#1 dans main
# 2. sur l'hôte Odoo (adapter service/DB/compose au réel — voir le
#    docs/DEPLOIEMENT_VPS.md du dépôt crm) :
cd <repo crm sur l'hôte> && git pull --ff-only origin main

sudo docker compose -f docker-compose.crm.yml exec -T odoo \
  odoo -d <DB_CRM> -u echango_promo_crm --stop-after-init --no-http
sudo docker compose -f docker-compose.crm.yml restart odoo
```

### 3.3 Vérifier

- Logs de l'update — on doit voir :
  ```
  Running upgrade [19.0.1.2.0>] post-migration
  cron_echango_promo_geocodage supprime (1 ligne)
  suppression de echango_promo_account.geocodage_le
  suppression de echango_promo_account.geocodage_latitude
  suppression de echango_promo_account.geocodage_longitude
  ```
- `SELECT COUNT(*) FROM ir_cron c JOIN ir_model_data d ON d.res_id=c.id
  WHERE d.model='ir.cron' AND d.name='cron_echango_promo_geocodage';` → **0**
- Une synchro de test (rejouer `npm run crm:sync` côté promo si dispo, sinon
  attendre 04:00) : fiches **acceptées**, `ville`/`wilaya` visibles sur la
  fiche de suivi, `state_id` posé sur le partenaire quand la wilaya est connue.

### 3.4 Rollback

Redéployer la version `19.0.1.1.0` (revert crm#1). ⚠️ les 3 colonnes
supprimées **ne reviennent pas seules** (une post-migration Odoo n'a pas de
`down`). Elles ne servaient qu'à la détection de dérive et **aucun consommateur
ne les lit** — les recréer n'a d'intérêt que pour un vrai retour arrière, à
partir d'un dump.

---

## 4. Promo — backend (PR echangopromo#33)

### 4.1 Ce que la PR fait

- `CommercantService.setPosition` géocode via `echango-geo` après avoir sauvé
  la position. **Ne lève jamais** : `echango-geo` injoignable → position
  quand même sauvée, `geocodageStatut = 'a_faire'`.
- `GeoReconcileService` — `@Cron` toutes les 30 min — reprend les `a_faire` /
  `erreur` et **géocode le parc positionné** après la migration.
- `crm-export` : `ville` / `wilaya` / `geocodage_statut` ajoutés au contrat
  `LigneCrm` (+ `docs/SPEC_INTEGRATION_ECHANGOCRM.md` §4.1).
- Migration `1783910000000-CommercantGeocodage` : colonnes `geocodageStatut`
  (5 états) / `villeGeocodee` / `wilayaGeocodee` / `geocodage{Latitude,
  Longitude,At}` + backfill (positionnés → `a_faire`, sans position →
  `sans_position`).
- **Pas de forward geocoding, pas de recherche de lieu client** — la décision
  6 du `PLAN_BASCULE_GEO` n'est rouverte que pour l'inverse côté serveur.

### 4.2 `.env.production` — ajouter

```
GEO_SERVICE_URL=http://geo-api:3000
GEO_INTERNAL_TOKEN=<le jeton du VPS echango-geo — identique>
GEO_HTTP_TIMEOUT_MS=8000
GEO_RECONCILE_BATCH=200
```

### 4.3 Déployer

```bash
# après merge echangopromo#33
cd <repo echangopromo sur l'hôte> && git pull --ff-only origin main

docker compose --env-file .env.production -f docker-compose.promo.yml \
  up -d --build backend
# La migration TypeORM tourne au démarrage du conteneur
# (Dockerfile : `typeorm migration:run` avant `node dist/main`).
```

### 4.4 Vérifier

```bash
# 1. le backend joint echango-geo
docker compose --env-file .env.production -f docker-compose.promo.yml exec -T backend \
  sh -c 'node -e "fetch(\"http://geo-api:3000/health\").then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"'
# → {"status":"ok","dependencies":{"nominatim":{"reachable":true}, ...}}

# 2. bout-en-bout : inscrire un commerçant, PATCH /commercant/me/position,
#    relire la fiche → villeGeocodee / wilayaGeocodee remplis,
#    geocodageStatut = 'fait'.

# 3. le reconcile : au 1er passage (≤ 30 min) il géocode le parc positionné.
docker compose --env-file .env.production -f docker-compose.promo.yml logs backend \
  | grep GeoReconcile
# → "N fiche(s) géocodée(s)"

# 4. l'export CRM porte les 3 champs
#    GET /crm/export (jeton admin) → chaque ligne a ville / wilaya / geocodage_statut

# 5. cas panne : couper geo-api, refaire un setPosition → il RÉUSSIT,
#    geocodageStatut = 'a_faire' ; relancer geo-api → le reconcile rattrape.
```

### 4.5 Bancs

- `echangopromo/scripts/check-geo-bascule.sh` (déjà dans le dépôt) — teste
  `GeoClientService` compilé contre `echango-geo`, sans monter le backend :
  ```bash
  cd apps/backend && npm run build && cd ../..
  GEO_SERVICE_URL=http://localhost:3000 GEO_INTERNAL_TOKEN=<jeton> \
    ./scripts/check-geo-bascule.sh
  ```
- Le banc **route complète** (`/commercant/me/position` → `ville`/`wilaya` →
  export CRM) dans le framework Python du dépôt : **pas encore écrit**. À
  faire au moment du déploiement (cible réelle disponible).

### 4.6 À surveiller

- **1er run du reconcile** : ~300 fiches (cf. `docs/DEPLOIEMENT_CRM_VPS.md`)
  géocodées contre le VPS `echango-geo`. Pas de quota (Nominatim local),
  mais regarder le premier log — quelques minutes.
- **1re synchro CRM de 04:00 après ce déploiement** : les fiches doivent être
  **acceptées** (le CRM doit déjà être en `19.0.1.2.0`, cf. §2).

### 4.7 Rollback

Redéployer le backend sans #33. La migration `1783910000000` a un `down()`
propre (drop colonnes + type enum + index) : `npm run migration:revert`. Les
positions (`latitude`/`longitude`) ne sont pas touchées.

---

## 5. Delivery — BFF (PR echango-delivery#13)

### 5.1 Ce que la PR fait

- `GeocodingService` → client HTTP d'`echango-geo`. `toPlace()` (~80 lignes),
  throttle 1100 ms et en-tête `User-Agent` supprimés.
- `search` **et** `reverse` → `503 geocoding.unavailable` si `echango-geo`
  est injoignable. `reverse` n'avale plus l'erreur en rendant un `Place` à
  libellé vide.
- `/health` : sonde `geo` à côté de `fleetbase`. Sonde de joignabilité
  factorisée (`common/http/reachability.ts`).
- Contrat `GeocodedPlace` inchangé — **aucun écran, aucun DTO touché**.

### 5.2 `.env.production` — remplacer le bloc Nominatim

```
GEO_SERVICE_URL=http://geo-api:3000
GEO_INTERNAL_TOKEN=<le jeton du VPS — identique>
GEO_SERVICE_TIMEOUT_MS=12000
GEOCODING_COUNTRY=dz
# SUPPRIMER : NOMINATIM_URL, NOMINATIM_USER_AGENT
```

### 5.3 Déployer

```bash
# après merge echango-delivery#13
cd <repo delivery sur l'hôte> && git pull --ff-only origin main
docker compose -f <compose delivery> up -d --build bff
```

### 5.4 Vérifier

```bash
# /health porte "geo": {reachable:true}
curl -s http://<bff>/health | jq .dependencies.geo

# géocodage par le vrai chemin (route @Persona('merchant')) :
#   echango-delivery/scripts/test-geocodage.sh (dans le dépôt, branché dans
#   run-all-scenarios.sh). Besoin d'un BFF + Fleetbase + Postgres up.
BFF_URL=http://localhost:3001 GEO_INTERNAL_TOKEN=<jeton> \
  ./scripts/test-geocodage.sh
#   GEO_PANNE=1 en plus → teste la coupure d'echango-geo (503, jamais 400)

# check direct sans Fleetbase :
#   echango-delivery/scripts/check-geo-bascule.sh (GeoClientService compilé)
```

### 5.5 Rollback

Redéployer sans #13, remettre `NOMINATIM_URL` dans le `.env`. **Aucune
migration** (pas de base touchée).

---

## 6. Checklist finale

- [ ] `GEO_INTERNAL_TOKEN` identique : VPS `echango-geo`, promo, delivery
- [ ] cron `refresh-osm.sh` dans la crontab **root** du VPS
- [ ] **CRM** `19.0.1.2.0` déployé — logs de migration ok, cron géocodage à 0,
      synchro de test acceptée
- [ ] **Promo** backend #33 déployé — migration ok, 1er run du reconcile ok,
      `/crm/export` porte `ville`/`wilaya`/`geocodage_statut`
- [ ] 1re synchro CRM 04:00 post-déploiement promo : **0 fiche rejetée**
- [ ] **Delivery** BFF #13 déployé — `/health.dependencies.geo.reachable = true`,
      un géocodage réel renvoie un `Place` décomposé
- [ ] bancs `test-geocodage.sh` (delivery) et route complète (promo) rejoués
      dans leurs environnements

---

## 7. Liens

- Specs service : `docs/specs_echango_geo_v1.md`
- Déploiement du service : `docs/DEPLOIEMENT_VPS.md`
- PR crm#1 : `https://github.com/ecolealgerienne-ui/crm/pull/1`
- PR echangopromo#33 : `https://github.com/ecolealgerienne-ui/echangopromo/pull/33`
- PR echango-delivery#13 : `https://github.com/ecolealgerienne-ui/echango-delivery/pull/13`
