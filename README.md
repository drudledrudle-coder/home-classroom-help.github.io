# DropRadar UK 🔴

An independent **Pokémon Center UK drop-prediction bot** — its own take on
*isthereadroptoday.com*. A scheduled scraper watches three sources, a
transparent cadence model turns them into a probability, and a static
GitHub Pages site renders the verdict.

> **Not affiliated** with The Pokémon Company, Pokémon Center, or
> isthereadroptoday.com. Predictions are estimates, not guarantees.

## How it works

```
                 GitHub Actions (cron every 15 min)
                 ┌─────────────────────────────────────────┐
  Pokémon Center │  scrape_pokemoncenter.py  ─┐             │
  UK backend ───▶│  scrape_x.py             ──┼─▶ predict.py│──▶ data/status.json
  X communities  │  scrape_isthereadroptoday.py┘  (run.py)  │──▶ data/history.json
  isthereadrop…  └─────────────────────────────────────────┘        │
                                                                     ▼
                                        GitHub Pages (index.html + app.js) renders it
```

### Sources
| Source | Signal | File |
|---|---|---|
| **Pokémon Center UK** storefront (Elastic Path `tpci-ecommweb-api`) | Watched-SKU availability & result counts | `scripts/scrape_pokemoncenter.py` |
| **X communities** (X API v2 recent search) | "dropped / live now / restock" post volume | `scripts/scrape_x.py` |
| **isthereadroptoday.com** | Reference status + historical drop dates (seeds our history) | `scripts/scrape_isthereadroptoday.py` |

Every source is best-effort: if one is blocked/offline it degrades to
"unknown" and the pipeline still publishes.

### The model (`scripts/predict.py`)
- **Base rate (history):** day-of-week frequency + how *overdue* a drop is
  relative to the average gap between past drops.
- **Live boost (real-time):** a burst of X drop-chatter and/or a jump in
  available watched SKUs pushes the probability up (and can flip the verdict
  to a live **YES**).
- Outputs `probability`, a plain-English list of `reasons`, and a
  `next_drop_estimate`.

## Data files (published by the bot)
- `data/status.json` — current prediction + latest signals + source health.
- `data/history.json` — the persistent, de-duplicated drop log.

## Running locally
```bash
pip install -r scripts/requirements.txt
python scripts/run.py            # writes data/status.json + data/history.json
python -m http.server            # then open http://localhost:8000
```

## Configuration
- **X signal (optional):** add a repo secret `X_BEARER_TOKEN` (X API v2
  bearer). Without it, the X source simply reports "unavailable".
- **Watched terms / queries:** edit `WATCH_TERMS` in
  `scrape_pokemoncenter.py` and `QUERY` in `scrape_x.py`.
- **Cadence:** the model self-tunes from `history.json`; seed history lives
  there and is refined automatically as real drops are observed.

## Deploy
It's a static site. Enable **GitHub Pages** (Settings → Pages → deploy from
the default branch) and enable **Actions**. The `update-drops` workflow runs
every 15 minutes and commits fresh data back to the repo.
