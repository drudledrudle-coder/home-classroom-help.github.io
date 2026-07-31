"""Scrape isthereadroptoday.com for the reference status + historical drops.

This is our "ground truth" seed: the site tracks Pokémon Center UK drops and
publishes today's status plus a log of past drops. We parse whatever we can and
fold it into our own history so our model has data on day one. The site sits
behind Cloudflare and frequently 403s automated fetches, so this source is
best-effort: on failure we return ``ok: False`` and rely on our stored history.

The parser is deliberately tolerant — it looks for a yes/no status token and
for date-shaped strings in the document rather than depending on exact markup,
which changes without notice.
"""
from __future__ import annotations

import re
from typing import Any

from common import get, iso, now_utc

URL = "https://isthereadroptoday.com/"

_YES_RE = re.compile(r"\b(yes|there is a drop|drop is live|live now)\b", re.IGNORECASE)
_NO_RE = re.compile(r"\b(no|no drop|not today)\b", re.IGNORECASE)
# Match ISO dates and common "1 January 2025" / "Jan 1, 2025" shapes.
_DATE_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b"
)


def _text_from_html(html: str) -> str:
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        return soup.get_text(" ", strip=True)
    except Exception:  # bs4 missing or parse error — fall back to a regex strip
        return re.sub(r"<[^>]+>", " ", html)


def scrape() -> dict[str, Any]:
    checked_at = iso(now_utc())
    resp = get(URL, headers={"Referer": "https://www.google.com/"})
    if resp is None:
        return {
            "source": "isthereadroptoday.com",
            "ok": False,
            "checked_at": checked_at,
            "status": "unknown",
            "past_drops": [],
            "note": "reference site unreachable (Cloudflare/403); using stored history",
        }

    text = _text_from_html(resp.text)
    head = text[:400].lower()  # status lives near the top of the page

    status = "unknown"
    if _YES_RE.search(head):
        status = "yes"
    elif _NO_RE.search(head):
        status = "no"

    # Historical drop dates mentioned anywhere on the page.
    seen: list[str] = []
    for m in _DATE_RE.finditer(text):
        d = m.group(0)
        if d not in seen:
            seen.append(d)

    return {
        "source": "isthereadroptoday.com",
        "ok": True,
        "checked_at": checked_at,
        "status": status,
        "past_drops": seen[:60],
        "note": "ok",
    }


if __name__ == "__main__":
    import json
    print(json.dumps(scrape(), indent=2))
