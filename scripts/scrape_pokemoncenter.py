"""Scrape the Pokémon Center UK storefront backend for live signals.

Pokémon Center runs on Elastic Path Commerce fronted by an API the storefront
itself calls: ``/tpci-ecommweb-api/...``. We use two public, unauthenticated
signals that reliably move around a drop:

1. **Keyword search counts** for hot lines (e.g. "elite trainer box",
   "booster bundle"). A drop typically publishes a batch of new SKUs, so the
   number of matching products jumps.
2. **Availability state** of those SKUs. Products flip from
   ``AVAILABLE`` / ``preorder`` to ``NOT_AVAILABLE`` when a drop sells through.

We never place anything in a cart or authenticate. Read-only signals only.
If the backend is unreachable the function returns a ``ok: False`` payload and
the pipeline carries on.
"""
from __future__ import annotations

from typing import Any

from common import get, iso, now_utc

# UK storefront. The API host mirrors the storefront host; the path prefix is
# the storefront's own XHR API used to render search/product pages.
BASE = "https://www.pokemoncenter.com"
SEARCH_API = f"{BASE}/tpci-ecommweb-api/search"

# Terms whose result counts spike around a UK drop. Tune freely.
WATCH_TERMS = [
    "elite trainer box",
    "booster bundle",
    "booster box",
    "premium collection",
    "pokemon center exclusive",
]


def _search(term: str) -> dict[str, Any] | None:
    """One keyword search against the storefront API.

    Elastic Path search returns a paginated result set; we only need the total
    count and the availability of the first page of hits.
    """
    resp = get(
        SEARCH_API,
        params={"keyword": term, "locale": "en-GB", "page": 1, "size": 20},
        headers={
            "Accept": "application/json",
            "X-Store-Scope": "pokemon-uk",  # UK storefront scope
            "Referer": f"{BASE}/en-gb/search?keyword={term.replace(' ', '+')}",
        },
    )
    if resp is None:
        return None
    try:
        data = resp.json()
    except ValueError:
        return None

    # Elastic Path shapes vary by deployment; probe the common keys defensively.
    results = (
        data.get("results")
        or data.get("items")
        or data.get("products")
        or []
    )
    total = (
        data.get("pagination", {}).get("totalResults")
        if isinstance(data.get("pagination"), dict)
        else data.get("total") or data.get("totalResults") or len(results)
    )
    available = 0
    for item in results:
        state = str(
            item.get("availability")
            or item.get("availabilityState")
            or item.get("stockStatus")
            or ""
        ).upper()
        if "AVAILABLE" in state or state in ("IN_STOCK", "PREORDER"):
            available += 1
    return {"term": term, "total": total, "sampled": len(results), "available": available}


def scrape() -> dict[str, Any]:
    checked_at = iso(now_utc())
    terms: list[dict[str, Any]] = []
    reachable = False
    for term in WATCH_TERMS:
        res = _search(term)
        if res is not None:
            reachable = True
            terms.append(res)

    total_available = sum(t["available"] for t in terms)
    total_products = sum((t["total"] or 0) for t in terms)

    return {
        "source": "pokemoncenter-uk",
        "ok": reachable,
        "checked_at": checked_at,
        "terms": terms,
        "total_products": total_products,
        "available_now": total_available,
        # A crude "the store just gained a lot of matching SKUs" signal.
        "note": (
            "backend reachable" if reachable
            else "backend unreachable (blocked or offline); signal unknown"
        ),
    }


if __name__ == "__main__":
    import json
    print(json.dumps(scrape(), indent=2))
