"""Pipeline entrypoint — run by the GitHub Actions cron.

Steps:
  1. Load the persistent drop history (``data/history.json``).
  2. Run all three scrapers (Pokémon Center UK, X, isthereadroptoday.com).
  3. Fold any newly-discovered past drops from the reference site into history.
  4. If live signals indicate a drop is happening *today*, log today as a drop.
  5. Run the prediction model.
  6. Publish ``data/status.json`` (what the site renders) and the updated
     ``data/history.json``.

Everything is defensive: a dead source degrades to "unknown" and the site
still updates with whatever we have.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from common import DATA_DIR, iso, load_json, now_utc, write_json
from predict import _parse_date, predict
import scrape_isthereadroptoday
import scrape_pokemoncenter
import scrape_x

HISTORY_PATH = DATA_DIR / "history.json"
STATUS_PATH = DATA_DIR / "status.json"


def _merge_reference_history(history: dict[str, Any], itadt: dict[str, Any]) -> int:
    """Add past-drop dates found on isthereadroptoday.com. Returns count added."""
    existing = {d["date"] for d in history["drops"]}
    added = 0
    for raw in itadt.get("past_drops", []):
        d = _parse_date(raw)
        if d and d.isoformat() not in existing:
            history["drops"].append(
                {
                    "date": d.isoformat(),
                    "title": "Pokémon Center UK drop",
                    "region": "UK",
                    "source": "isthereadroptoday.com",
                }
            )
            existing.add(d.isoformat())
            added += 1
    return added


def _maybe_log_today(history: dict[str, Any], pc: dict[str, Any],
                     x: dict[str, Any]) -> bool:
    """If signals say a drop is live now, record today (once). Returns True if logged."""
    today = now_utc().date().isoformat()
    if any(d["date"] == today for d in history["drops"]):
        return False
    live = (x.get("drop_mentions", 0) >= 3) or (pc.get("available_now", 0) >= 5)
    if live:
        history["drops"].append(
            {
                "date": today,
                "title": "Live drop detected",
                "region": "UK",
                "source": "x+pokemoncenter signals",
            }
        )
        return True
    return False


def main() -> None:
    history: dict[str, Any] = load_json(HISTORY_PATH, {"drops": []})
    history.setdefault("drops", [])

    pc = scrape_pokemoncenter.scrape()
    x = scrape_x.scrape()
    itadt = scrape_isthereadroptoday.scrape()

    added = _merge_reference_history(history, itadt)
    logged_today = _maybe_log_today(history, pc, x)

    # Keep history sorted, de-duplicated by date, oldest→newest.
    dedup: dict[str, Any] = {}
    for d in history["drops"]:
        dedup[d["date"]] = d
    history["drops"] = [dedup[k] for k in sorted(dedup)]
    history["updated_at"] = iso(now_utc())
    history["count"] = len(history["drops"])

    prediction = predict(history["drops"], pc, x)

    status = {
        "prediction": prediction,
        "signals": {
            "pokemoncenter": pc,
            "x": x,
            "isthereadroptoday": itadt,
        },
        "source_health": {
            "pokemoncenter": pc.get("ok", False),
            "x": x.get("ok", False),
            "isthereadroptoday": itadt.get("ok", False),
        },
        "pipeline": {
            "ran_at": iso(now_utc()),
            "reference_drops_added": added,
            "logged_today_as_drop": logged_today,
        },
    }

    write_json(HISTORY_PATH, history)
    write_json(STATUS_PATH, status)

    p = prediction
    print(
        f"[{iso(now_utc())}] {p['verdict']} "
        f"({p['probability']}%) | history={history['count']} "
        f"| sources ok: pc={pc.get('ok')} x={x.get('ok')} itadt={itadt.get('ok')} "
        f"| +{added} ref drops"
    )


if __name__ == "__main__":
    main()
