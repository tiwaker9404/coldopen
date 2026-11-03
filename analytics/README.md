# Hiring signals pipeline

What powers the [Hiring Index](https://tiwaker9404.github.io/coldopen/hiring-index/): every open role at 450+ tech companies and YC startups, snapshotted daily from their own job boards and modeled into who's hiring, for what, and at what pay.

```
GitHub Actions (daily)
  └─ snapshot.ts ── 450+ Greenhouse / Lever / Ashby boards ──▶ data branch: snapshots/YYYY-MM-DD.csv.gz   (raw)
       └─ dbt build (DuckDB)
            ├─ stg_postings      typed, deduped, job family from the title, pay midpoint    (staging)
            ├─ fct_company_day   open and newly posted roles per company per day            (marts)
            ├─ fct_family_day    US roles by family: volume, pay quartiles, remote, H-1B
            └─ fct_family_week   roles open today by posted week (hiring velocity)
                 + tests: not_null, accepted_values, one row per company per day
       └─ export.py ──▶ hiring-index/data.json ──▶ GitHub Pages
```

- **Raw stays raw.** Snapshots are append-only gzipped CSV on the `data` branch, so any model can be rebuilt from day one.
- **Logic lives in SQL.** Job families, pay midpoints and hiring velocity are dbt models, tested on every run; a failing test stops the publish.
- **Free to run.** GitHub Actions, DuckDB and GitHub Pages; no warehouse bill.

Run it yourself:

```bash
node analytics/snapshot.ts snapshots                  # today's snapshot
cd analytics && dbt build --profiles-dir . --vars "{snapshots: '../snapshots'}"
python export.py warehouse.duckdb data.json
```
