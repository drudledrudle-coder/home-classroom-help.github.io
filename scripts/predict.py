"""Turn drop history + live signals into a prediction.

The model is deliberately simple and explainable — a transparent heuristic beats
an opaque black box for something a human wants to sanity-check before queuing:

Base rate (history only)
------------------------
* **Day-of-week weight** — historically most PC-UK drops land on the same
  couple of weekdays. We score today's weekday by its share of past drops.
* **Cadence / overdue factor** — drops cluster around an average gap. The
  longer it's been since the last drop relative to that average, the more
  "due" we are.

Live boost (real-time signals)
------------------------------
* **X chatter** — a burst of "dropped / live now / restock" posts is the
  strongest same-day signal.
* **Store backend** — a jump in available matching SKUs corroborates.

The base rate and live boost combine into a single 0–100 probability plus a
human-readable set of reasons, and we forecast the next likely drop date from
the cadence.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from common import iso, now_utc


def _parse_date(s: str) -> _dt.date | None:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y",
                "%B %d %Y", "%b %d %Y", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return _dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    # Last resort: ISO timestamp prefix
    try:
        return _dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def predict(history: list[dict[str, Any]], pc: dict[str, Any],
            x: dict[str, Any]) -> dict[str, Any]:
    """history: list of {"date": "YYYY-MM-DD", ...} sorted oldest→newest."""
    today = now_utc().date()
    dates = sorted({d for d in (_parse_date(h.get("date", "")) for h in history) if d})

    reasons: list[str] = []
    base = 8.0  # small floor: a drop can always happen

    # --- Day-of-week weighting -------------------------------------------
    dow_score = 0.0
    if dates:
        counts = [0] * 7
        for d in dates:
            counts[d.weekday()] += 1
        total = sum(counts)
        share = counts[today.weekday()] / total if total else 0
        dow_score = share * 55.0  # weekday can contribute up to ~55 pts
        weekday_name = today.strftime("%A")
        if share > 0:
            reasons.append(
                f"{share*100:.0f}% of past drops landed on a {weekday_name} "
                f"({counts[today.weekday()]}/{total})."
            )
        else:
            reasons.append(f"No past drop has ever landed on a {weekday_name}.")

    # --- Cadence / overdue factor ----------------------------------------
    cadence_score = 0.0
    avg_gap = None
    next_drop_est = None
    if len(dates) >= 2:
        gaps = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        gaps = [g for g in gaps if g > 0]
        if gaps:
            avg_gap = sum(gaps) / len(gaps)
            since = (today - dates[-1]).days
            ratio = since / avg_gap if avg_gap else 0
            # Peak "due-ness" right around the average gap.
            cadence_score = _clamp(ratio * 30.0, 0, 35)
            next_drop_est = dates[-1] + _dt.timedelta(days=round(avg_gap))
            reasons.append(
                f"Last drop was {since} day(s) ago; average gap is "
                f"{avg_gap:.0f} days (≈{ratio*100:.0f}% of the way to due)."
            )

    base = _clamp(base + dow_score + cadence_score)

    # --- Live boost ------------------------------------------------------
    boost = 0.0
    if x.get("ok"):
        mentions = x.get("drop_mentions", 0)
        if mentions >= 3:
            boost += 40
            reasons.append(f"🔴 X chatter spiking: {mentions} live-drop posts right now.")
        elif mentions >= 1:
            boost += 18
            reasons.append(f"X mentions of a live drop: {mentions}.")
        elif x.get("volume", 0) > 20:
            boost += 6
            reasons.append(f"Elevated X volume ({x['volume']} posts) but no clear live calls.")
    if pc.get("ok"):
        avail = pc.get("available_now", 0)
        if avail >= 5:
            boost += 20
            reasons.append(f"🟢 Store backend shows {avail} watched SKUs available now.")
        elif avail >= 1:
            boost += 8
            reasons.append(f"Store backend shows {avail} watched SKU(s) available.")

    probability = _clamp(base + boost)

    # --- Verdict ---------------------------------------------------------
    live = (x.get("drop_mentions", 0) >= 3) or (pc.get("available_now", 0) >= 5)
    if live:
        verdict, status = "YES — a drop looks live right now", "live"
    elif probability >= 60:
        verdict, status = "LIKELY — high chance of a drop today", "likely"
    elif probability >= 30:
        verdict, status = "MAYBE — keep an eye out", "maybe"
    else:
        verdict, status = "NO — no drop expected today", "no"

    return {
        "generated_at": iso(now_utc()),
        "date": today.isoformat(),
        "probability": round(probability),
        "status": status,
        "verdict": verdict,
        "reasons": reasons,
        "base_rate": round(base),
        "live_boost": round(boost),
        "avg_gap_days": round(avg_gap, 1) if avg_gap else None,
        "last_drop": dates[-1].isoformat() if dates else None,
        "next_drop_estimate": next_drop_est.isoformat() if next_drop_est else None,
        "history_count": len(dates),
    }


if __name__ == "__main__":
    import json
    demo = predict([{"date": "2025-01-10"}, {"date": "2025-01-24"}], {}, {})
    print(json.dumps(demo, indent=2))
