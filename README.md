# echango-geo

Service transverse de géolocalisation pour l'écosystème Echango
(`echango-delivery`, `echangoorder`, `echangopromo`, `crm`, et les projets à
venir) : géocodage (adresse ↔ point), et plus tard itinéraire/distance
routière.

Auto-hébergé, par-dessus OpenStreetMap (Nominatim, puis OSRM/Valhalla si
besoin) — aucune clé API tierce, pas de facturation au volume.

**Statut : specs, rien d'implémenté.** Voir
[`docs/specs_echango_geo_v1.md`](docs/specs_echango_geo_v1.md) pour le
contrat détaillé, l'architecture, le plan de déploiement et la migration des
consommateurs existants.

Ce que ce service **n'est pas** : un entrepôt de données produit, ni un
moteur de recherche de proximité sur des données commerçant/transporteur —
voir §1.2 et §4 des specs pour le principe qui tranche.
