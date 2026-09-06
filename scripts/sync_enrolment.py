#!/usr/bin/env python3
"""
Daily sync: pull each school's current total enrolment from the
mwaqas3341-aeo/SIS-online-Enrolment-Updater repo's per-district JSON
files (scraped from sis.pesrp.edu.pk) and update
public_schools.total_enrollment in Supabase, matched by EMIS code.

SAFETY
------
- Only ever UPDATEs a row whose emis already exists in public_schools.
  It never inserts a new row for an EMIS it doesn't recognise, and it
  never deletes anything.
- Only ever writes the single column total_enrollment. Every other
  column on that row is left exactly as it was.
- school_category (and the area-derived columns) recalculate
  automatically the instant total_enrollment changes, via the
  trg_public_schools_recalculate trigger — see
  public_schools_auto_calc.sql. This script does not touch
  school_category itself.

Requires two GitHub Actions secrets on the A-I-DB repo:
  SUPABASE_URL                e.g. https://bnvrblekeppkpvcjjpli.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   Project Settings -> API -> service_role key
                              (NOT the anon key — this needs to bypass RLS
                              to write across every jurisdiction's schools;
                              never put this key in client-side code).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

SIS_INDEX_URL = (
    "https://raw.githubusercontent.com/mwaqas3341-aeo/"
    "SIS-online-Enrolment-Updater/main/data/index.json"
)
SIS_RAW_BASE = (
    "https://raw.githubusercontent.com/mwaqas3341-aeo/"
    "SIS-online-Enrolment-Updater/main/"
)

BATCH_SIZE = 500
PAGE_SIZE = 1000


def _get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "aeo-enrolment-sync"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_sis_enrolment():
    """Returns {emis_code: total_school_students} across every district."""
    index = _get_json(SIS_INDEX_URL)
    enrolment = {}
    for d in index.get("districts", []):
        url = SIS_RAW_BASE + d["file"]
        try:
            data = _get_json(url)
        except urllib.error.URLError as e:
            print(f"WARN: could not fetch {d['file']}: {e}", file=sys.stderr)
            continue
        for school in data.get("schools", []):
            emis = str(school.get("emis_code") or "").strip()
            total = school.get("total_school_students")
            if not emis or total is None:
                continue
            enrolment[emis] = total
    return enrolment


def fetch_existing_emis(supabase_url, service_key):
    """Every EMIS already present in public_schools. We only ever UPDATE
    these — this set is the guardrail against ever inserting a new row."""
    existing = set()
    offset = 0
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
    while True:
        url = f"{supabase_url}/rest/v1/public_schools?select=emis&limit={PAGE_SIZE}&offset={offset}"
        rows = _get_json(url, headers=headers)
        if not rows:
            break
        existing.update(str(row["emis"]) for row in rows)
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return existing


def push_batch(supabase_url, service_key, batch):
    """Upsert restricted to emis + total_enrollment only. Every emis in
    `batch` was already confirmed to exist in fetch_existing_emis(), so
    this can only ever resolve as an UPDATE of that one column — it
    cannot create a new row or touch any other field."""
    url = f"{supabase_url}/rest/v1/public_schools?on_conflict=emis"
    body = json.dumps(batch).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status


def main():
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    print("Fetching current enrolment from SIS-online-Enrolment-Updater...")
    sis_enrolment = fetch_sis_enrolment()
    print(f"  {len(sis_enrolment)} schools found across all districts.")

    print("Fetching existing EMIS codes from public_schools...")
    existing = fetch_existing_emis(supabase_url, service_key)
    print(f"  {len(existing)} schools currently in public_schools.")

    matched = [
        {"emis": emis, "total_enrollment": total}
        for emis, total in sis_enrolment.items()
        if emis in existing
    ]
    skipped = len(sis_enrolment) - len(matched)
    print(
        f"  {len(matched)} matched and will be updated; "
        f"{skipped} SIS entries have no matching EMIS in public_schools "
        f"(skipped, NOT inserted)."
    )

    updated = 0
    for i in range(0, len(matched), BATCH_SIZE):
        batch = matched[i : i + BATCH_SIZE]
        push_batch(supabase_url, service_key, batch)
        updated += len(batch)
        print(f"  updated {updated}/{len(matched)}...")
        time.sleep(0.2)

    print(
        f"Done. {updated} schools' total_enrollment updated; "
        f"school_category recalculates automatically via the DB trigger."
    )


if __name__ == "__main__":
    main()
