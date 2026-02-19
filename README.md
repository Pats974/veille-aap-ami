# Veille AAP/AMI — mise à jour automatique

Cette base alimente une app de veille AAP/AMI depuis **Aides-territoires** sans maintenance manuelle des sources.

## Fonctionnement

- Source principale : **API Aides-territoires** (accès ouvert, référencée sur data.gouv.fr).
- Tous les jours, une GitHub Action exécute `scripts/update_opportunities.py`.
- Le script lit `data/collector.config.json`, récupère les aides, filtre **La Réunion (974)** + mots-clés, déduplique, puis met à jour `data/opportunities.seed.json`.
- Si aucune différence n'est détectée, la PR automatisée n'ajoute pas de nouveau changement.

## Configuration (sans code)

Modifiez `data/collector.config.json` pour adapter :

- `territory_code`
- `include_types`
- `keywords_include` / `keywords_exclude`
- `freshness_days`
- `max_items`

## Lancer en local

```bash
python scripts/update_opportunities.py
```

## Schéma des données

Le fichier `data/opportunities.seed.json` contient :

- `_meta.generated_at`
- `_meta.sources[]` avec attribution
- `opportunities[]` (title, issuer, deadline, url, description, territoire, tags, type, montant, etc.)

## Attribution et licence des données source

Attribution ajoutée dans `_meta.sources[].attribution_text`.

> Données issues de l'API Aides-territoires (Licence Ouverte v2.0). Réutilisation sous réserve du respect des conditions d'utilisation et de l'attribution.

Merci de respecter les conditions d'utilisation de la source et la **Licence Ouverte v2.0** lors de toute réutilisation.
