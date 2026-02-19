#!/usr/bin/env python3
"""Fetch and refresh opportunities.seed.json from Aides-territoires API."""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "collector.config.json"
OUTPUT_PATH = ROOT / "data" / "opportunities.seed.json"
REQUEST_TIMEOUT_SECONDS = 25

API_CANDIDATES = [
    "https://aides-territoires.beta.gouv.fr/api/aids/",
    "https://aides-territoires.incubateur.net/api/aids/",
]

SOURCE_ATTRIBUTION = (
    "Données issues de l'API Aides-territoires (Licence Ouverte v2.0). "
    "Réutilisation sous réserve du respect des conditions d'utilisation et de l'attribution."
)


@dataclass
class CollectorConfig:
    territory_code: str
    include_types: list[str]
    keywords_include: list[str]
    keywords_exclude: list[str]
    freshness_days: int
    max_items: int
    update_strategy: str


class CollectorError(Exception):
    """Collector controlled failure."""


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_config(path: Path) -> CollectorConfig:
    data = load_json(path)
    if not isinstance(data, dict):
        raise CollectorError(f"Invalid config format in {path}")

    return CollectorConfig(
        territory_code=str(data.get("territory_code", "974")),
        include_types=[str(x).upper() for x in data.get("include_types", ["AAP", "AMI"])],
        keywords_include=[str(x) for x in data.get("keywords_include", [])],
        keywords_exclude=[str(x) for x in data.get("keywords_exclude", [])],
        freshness_days=int(data.get("freshness_days", 365)),
        max_items=int(data.get("max_items", 300)),
        update_strategy=str(data.get("update_strategy", "merge_by_url_then_title")),
    )


def api_get(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    query = urlencode({k: v for k, v in (params or {}).items() if v is not None}, doseq=True)
    full_url = f"{url}?{query}" if query else url
    req = Request(full_url, headers={"Accept": "application/json", "User-Agent": "veille-aap-ami-bot/1.0"})

    with urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get("Content-Type", "")
        if "json" not in content_type:
            raise CollectorError(f"Unexpected API content-type for {full_url}: {content_type}")
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def select_working_api() -> str:
    for candidate in API_CANDIDATES:
        try:
            api_get(candidate, {"page": 1, "page_size": 1})
            logging.info("Using API endpoint: %s", candidate)
            return candidate
        except Exception as exc:  # noqa: BLE001
            logging.warning("Cannot use %s (%s)", candidate, exc)
    raise CollectorError("No reachable Aides-territoires API endpoint.")


def extract_text_fields(raw: dict[str, Any]) -> str:
    bits = [
        raw.get("name"),
        raw.get("title"),
        raw.get("description"),
        raw.get("short_description"),
        raw.get("provider_name"),
        raw.get("author"),
    ]
    return " ".join(str(x) for x in bits if x)


def detect_type(raw: dict[str, Any], include_types: list[str]) -> str | None:
    type_candidates: list[str] = []
    for key in ("type", "types", "nature", "kinds", "category"):
        value = raw.get(key)
        if isinstance(value, list):
            type_candidates.extend(str(v).upper() for v in value)
        elif value:
            type_candidates.append(str(value).upper())

    corpus = " ".join(type_candidates + [extract_text_fields(raw).upper()])

    if "AMI" in corpus or "MANIFESTATION D'INTÉRÊT" in corpus or "MANIFESTATION D’INTÉRÊT" in corpus:
        return "AMI" if "AMI" in include_types else None
    if "AAP" in corpus or "APPEL À PROJETS" in corpus or "APPEL A PROJETS" in corpus:
        return "AAP" if "AAP" in include_types else None
    return None


def has_territory(raw: dict[str, Any], territory_code: str) -> bool:
    territory_blob = json.dumps(raw.get("perimeters") or raw.get("territories") or raw.get("location") or raw, ensure_ascii=False).lower()
    return territory_code.lower() in territory_blob or "réunion" in territory_blob or "reunion" in territory_blob


def parse_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    # Keep YYYY-MM-DD if present
    match = re.search(r"(\d{4}-\d{2}-\d{2})", text)
    if match:
        return match.group(1)
    return None


def normalize_item(raw: dict[str, Any], include_types: list[str]) -> dict[str, Any] | None:
    title = raw.get("name") or raw.get("title")
    if not title:
        return None

    opportunity_type = detect_type(raw, include_types)
    if not opportunity_type:
        return None

    url = raw.get("url") or raw.get("external_url") or raw.get("source_url")
    if not url and raw.get("id"):
        url = f"https://aides-territoires.beta.gouv.fr/aides/{raw['id']}"

    deadline = parse_date(raw.get("date_submission_deadline") or raw.get("deadline") or raw.get("closing_date"))
    discovered_at = datetime.now(timezone.utc).isoformat()

    return {
        "id": str(raw.get("id") or "").strip() or None,
        "title": str(title).strip(),
        "issuer": str(raw.get("provider_name") or raw.get("issuer") or "Inconnu").strip(),
        "deadline": deadline,
        "calendar": raw.get("calendar") or raw.get("period") or None,
        "url": url,
        "description": str(raw.get("description") or raw.get("short_description") or "").strip(),
        "territory": raw.get("perimeters") or raw.get("territories") or None,
        "tags": raw.get("tags") or raw.get("categories") or [],
        "type": opportunity_type,
        "amount": raw.get("amount") or raw.get("financial_amount") or None,
        "source": "Aides-territoires API",
        "source_last_checked_at": datetime.now(timezone.utc).isoformat(),
        "discovered_at": discovered_at,
    }


def include_by_keywords(item: dict[str, Any], cfg: CollectorConfig) -> bool:
    text = " ".join(
        [
            item.get("title") or "",
            item.get("description") or "",
            item.get("issuer") or "",
            item.get("type") or "",
            " ".join(item.get("tags") or []),
        ]
    ).lower()

    if any(word.lower() in text for word in cfg.keywords_exclude):
        return False

    if not cfg.keywords_include:
        return True
    return any(word.lower() in text for word in cfg.keywords_include)


def fetch_items(api_url: str, cfg: CollectorConfig) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    page = 1
    max_pages = 80
    freshness_threshold = datetime.now(timezone.utc) - timedelta(days=cfg.freshness_days)

    while page <= max_pages and len(items) < cfg.max_items:
        data = api_get(api_url, {"page": page, "page_size": 50, "ordering": "-date_updated"})
        results = data.get("results")
        if not isinstance(results, list) or not results:
            break

        for raw in results:
            if not isinstance(raw, dict):
                continue
            if not has_territory(raw, cfg.territory_code):
                continue

            normalized = normalize_item(raw, cfg.include_types)
            if not normalized:
                continue

            if not include_by_keywords(normalized, cfg):
                continue

            updated_date = parse_date(raw.get("date_updated") or raw.get("updated_at") or raw.get("updated"))
            if updated_date:
                try:
                    dt = datetime.fromisoformat(updated_date).replace(tzinfo=timezone.utc)
                    if dt < freshness_threshold:
                        continue
                except ValueError:
                    pass

            items.append(normalized)
            if len(items) >= cfg.max_items:
                break

        if not data.get("next"):
            break
        page += 1

    return items


def deduplicate(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for item in items:
        url = (item.get("url") or "").strip().lower()
        title = (item.get("title") or "").strip().lower()
        deadline = item.get("deadline") or ""
        key = f"url::{url}" if url else f"title_deadline::{title}::{deadline}"
        if key not in by_key:
            by_key[key] = item
    return list(by_key.values())


def merged_with_existing(existing: list[dict[str, Any]], fresh: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = deduplicate(existing + fresh)

    def sort_key(item: dict[str, Any]) -> tuple[str, str]:
        deadline = item.get("deadline") or "9999-12-31"
        discovered = item.get("discovered_at") or ""
        return (deadline, discovered)

    return sorted(merged, key=sort_key)


def write_output(path: Path, opportunities: list[dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "_meta": {
            "generated_at": now,
            "sources": [
                {
                    "name": "Aides-territoires API",
                    "attribution_text": SOURCE_ATTRIBUTION,
                    "last_checked_at": now,
                }
            ],
        },
        "opportunities": opportunities,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    cfg = load_config(CONFIG_PATH)
    existing_data = load_json(OUTPUT_PATH, default={}) or {}
    existing_opps = existing_data.get("opportunities", []) if isinstance(existing_data, dict) else []
    existing_opps = existing_opps if isinstance(existing_opps, list) else []

    try:
        api_url = select_working_api()
        fetched = fetch_items(api_url, cfg)
        merged = merged_with_existing(existing_opps, fetched)
        write_output(OUTPUT_PATH, merged)
        logging.info("Collected %s items (%s merged).", len(fetched), len(merged))
        return 0
    except (HTTPError, URLError, CollectorError, TimeoutError) as exc:
        logging.error("Collection failed: %s", exc)
        logging.error("Existing JSON was preserved at %s", OUTPUT_PATH)
        return 1


if __name__ == "__main__":
    sys.exit(run())
