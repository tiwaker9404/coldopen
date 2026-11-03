"""Exports the Hiring Index's numbers from the warehouse to the page's JSON.

    python analytics/export.py <warehouse.duckdb> <out.json>
"""

import json
import sys

import duckdb


def rows(con, sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, [str(v) if hasattr(v, "isoformat") else v for v in r])) for r in cur.fetchall()]


def main(db: str, out: str) -> None:
    con = duckdb.connect(db, read_only=True)
    latest = con.execute("select max(snapshot_date) from fct_family_day").fetchone()[0]
    days = con.execute("select count(distinct snapshot_date) from fct_family_day").fetchone()[0]
    data = {
        "asOf": str(latest),
        "snapshots": days,
        "totals": rows(
            con,
            f"""select count(distinct board) as companies, sum(open_roles) as open_roles,
                       sum(new_roles_30d) as new_roles_30d, sum(us_roles) as us_roles
                from fct_company_day where snapshot_date = '{latest}'""",
        )[0],
        "families": rows(
            con,
            f"""select * exclude (snapshot_date) from fct_family_day
                where snapshot_date = '{latest}' order by open_roles desc""",
        ),
        "weekly": rows(
            con, "select * from fct_family_week order by posted_week, job_family"
        ),
        "daily": rows(
            con,
            "select snapshot_date, job_family, open_roles from fct_family_day order by snapshot_date",
        ),
        "fastest": rows(
            con,
            f"""select company, yc_batch, visa_sponsor, open_roles, new_roles_30d
                from fct_company_day where snapshot_date = '{latest}' and new_roles_30d > 0
                order by new_roles_30d desc, open_roles desc limit 25""",
        ),
    }
    with open(out, "w") as f:
        json.dump(data, f, indent=1, default=str)
    print(f"{out}: {data['totals']['open_roles']} roles at {data['totals']['companies']} companies, {days} day(s)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
