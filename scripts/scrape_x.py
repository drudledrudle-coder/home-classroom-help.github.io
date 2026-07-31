"""Scrape X (Twitter) community chatter for drop signals.

Drops are almost always called out on X minutes before or as they happen. We
watch a set of terms and, when an ``X_BEARER_TOKEN`` secret is present, query
the official X API v2 recent-search endpoint. Without a token the module
degrades gracefully to ``ok: False`` (the API has no meaningful anonymous tier).

Signals extracted:
- **volume**: number of matching posts in the recent window.
- **drop_mentions**: posts whose text strongly implies a live drop
  ("dropped", "live now", "restock", "in stock").
- **latest**: the most recent matching post text + timestamp, for the ticker.
"""
from __future__ import annotations

import re
from typing import Any

from common import env, get, iso, now_utc

SEARCH_URL = "https://api.twitter.com/2/tweets/search/recent"

# Queries scoped to Pokémon Center UK drop talk. Communities can be added by
# their conversation/keyword; the API also accepts `context:` operators.
QUERY = (
    '("pokemon center" OR pokemoncenter OR "pokémon center") '
    '(uk OR "en-gb" OR restock OR drop OR dropped OR live) '
    '-is:retweet lang:en'
)

_LIVE_RE = re.compile(
    r"\b(dropped|drop is live|live now|restock|back in stock|in stock now|just went live)\b",
    re.IGNORECASE,
)


def scrape() -> dict[str, Any]:
    checked_at = iso(now_utc())
    token = env("X_BEARER_TOKEN")
    if not token:
        return {
            "source": "x-communities",
            "ok": False,
            "checked_at": checked_at,
            "volume": 0,
            "drop_mentions": 0,
            "posts": [],
            "note": "no X_BEARER_TOKEN secret configured; X signal unavailable",
        }

    resp = get(
        SEARCH_URL,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        params={
            "query": QUERY,
            "max_results": 50,
            "tweet.fields": "created_at,public_metrics",
        },
    )
    if resp is None:
        return {
            "source": "x-communities",
            "ok": False,
            "checked_at": checked_at,
            "volume": 0,
            "drop_mentions": 0,
            "posts": [],
            "note": "X API unreachable or rate-limited",
        }

    try:
        data = resp.json()
    except ValueError:
        data = {}

    tweets = data.get("data", []) or []
    posts: list[dict[str, Any]] = []
    drop_mentions = 0
    for tw in tweets:
        text = tw.get("text", "")
        is_live = bool(_LIVE_RE.search(text))
        if is_live:
            drop_mentions += 1
        posts.append(
            {
                "text": text[:240],
                "created_at": tw.get("created_at"),
                "live_signal": is_live,
                "likes": tw.get("public_metrics", {}).get("like_count", 0),
            }
        )

    # Sort newest first so the frontend ticker shows fresh chatter.
    posts.sort(key=lambda p: p.get("created_at") or "", reverse=True)

    return {
        "source": "x-communities",
        "ok": True,
        "checked_at": checked_at,
        "volume": len(tweets),
        "drop_mentions": drop_mentions,
        "posts": posts[:15],
        "note": "ok",
    }


if __name__ == "__main__":
    import json
    print(json.dumps(scrape(), indent=2))
