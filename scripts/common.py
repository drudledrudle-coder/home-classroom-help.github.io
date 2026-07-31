"""Shared helpers for the drop-tracker scrapers.

Everything here is intentionally defensive: the scrapers run unattended in a
GitHub Actions cron, targeting third-party sites that rate-limit, change markup,
or sit behind Cloudflare. A failed source should never crash the pipeline — it
should degrade to "unknown" so the rest of the data still publishes.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

# A realistic desktop User-Agent. Many of the targets (Pokémon Center behind
# Akamai, isthereadroptoday behind Cloudflare) reject the default requests UA.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
}


def now_utc() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def iso(dt: _dt.datetime) -> str:
    """UTC ISO-8601 with a trailing Z, seconds precision."""
    return dt.astimezone(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get(url: str, *, headers: dict | None = None, params: dict | None = None,
        timeout: int = 20, retries: int = 3) -> requests.Response | None:
    """GET with browser headers, exponential backoff, and no exceptions.

    Returns the Response on a 2xx, or ``None`` if the source is unreachable /
    keeps erroring. Callers treat ``None`` as "source unavailable".
    """
    merged = dict(BROWSER_HEADERS)
    if headers:
        merged.update(headers)
    delay = 2
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=merged, params=params, timeout=timeout)
            if resp.status_code == 200:
                return resp
            # 403/429/5xx are worth a retry; 404 is not.
            if resp.status_code in (404, 410):
                return None
        except requests.RequestException:
            pass
        if attempt < retries - 1:
            time.sleep(delay)
            delay *= 2
    return None


def load_json(path: Path, default: Any) -> Any:
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def env(name: str, default: str | None = None) -> str | None:
    val = os.environ.get(name, default)
    return val if val else default
