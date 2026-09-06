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
- EMIS codes are treated as strings everywhere (never int/float), so
  leading zeros or numeric-vs-string differences between files can
  never cause a code to be matched against the wrong school.

REQUIRES
--------
Two GitHub Actions secrets on the A-I-DB repo:
  SUPABASE_URL                e.g. https://bnvrblekeppkpvcjjpli.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   Project Settings -> API -> service_role key
                              (NOT the anon key — this needs to bypass RLS
                              to write across every jurisdiction's schools;
                              never put this key in client-side code).

Also requires a UNIQUE constraint on public_schools.emis (added via the
add_unique_constraint_public_schools_emis migration) — the upsert below
relies on Postgres' ON CONFLICT (emis) resolution, which fails outright
without it.

No GitHub token is needed to reach SIS-online-Enrolment-Updater: that
repo is public, so raw.githubusercontent.com serves its files over
plain HTTPS with no auth. If it's ever made private, fetch_sis_enrolment()
will need a `Authorization: token <PAT>` header sourced from a new
GitHub Actions secret (never hard-coded).
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
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2


class FetchError(Exception):
    """Raised when a remote resource can't be retrieved after retries."""


def _get_json(url, headers=None, max_retries=MAX_RETRIES):
    """GET a URL and parse it as JSON, retrying on transient failures
    (network errors, timeouts, 429/5xx) but not on 4xx client errors."""
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(
                url, headers=headers or {"User-Agent": "aeo-enrolment-sync"}
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode("utf-8")
            try:
                return json.loads(raw)
            except json.JSONDecodeError as e:
                raise FetchError(f"invalid JSON from {url}: {e}") from e
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code < 500 and e.code != 429:
                # Client error (404, 401, etc.) — retrying won't help.
                raise FetchError(f"HTTP {e.code} fetching {url}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
        if attempt < max_retries:
            time.sleep(RETRY_BACKOFF_SECONDS * attempt)
    raise FetchError(f"failed to fetch {url} after {max_retries} attempts: {last_err}")


def fetch_sis_enrolment():
    """Returns (enrolment, stats) where enrolment is {emis: total} across
    every district and stats tracks data-quality counts along the way."""
    stats = {
        "source_records": 0,
        "missing_emis": 0,
        "invalid_enrollment": 0,
        "duplicate_emis": 0,
        "districts_failed": 0,
    }

    index = _get_json(SIS_INDEX_URL)
    districts = index.get("districts", [])
    if not districts:
        raise FetchError("index.json has no 'districts' entries — refusing to sync 0 schools")

    enrolment = {}
    for d in districts:
        file_path = d.get("file")
        if not file_path:
            print(f"WARN: district entry missing 'file': {d}", file=sys.stderr)
            stats["districts_failed"] += 1
            continue
        url = SIS_RAW_BASE + file_path
        try:
            data = _get_json(url)
        except FetchError as e:
            print(f"WARN: could not fetch {file_path}: {e}", file=sys.stderr)
            stats["districts_failed"] += 1
            continue

        schools = data.get("schools")
        if not isinstance(schools, list):
            print(f"WARN: {file_path} has no 'schools' list — skipping file", file=sys.stderr)
            stats["districts_failed"] += 1
            continue

        for school in schools:
            stats["source_records"] += 1

            # Always treat EMIS as a string: never let JSON int/float
            # parsing or leading-zero stripping cross a code over to a
            # different school.
            emis_raw = school.get("emis_code")
            emis = str(emis_raw).strip() if emis_raw is not None else ""
            if not emis:
                stats["missing_emis"] += 1
                continue

            total = school.get("total_school_students")
            if total is None or isinstance(total, bool) or not isinstance(total, (int, float)):
                stats["invalid_enrollment"] += 1
                continue
            if total < 0:
                stats["invalid_enrollment"] += 1
                continue

            if emis in enrolment:
                stats["duplicate_emis"] += 1
            enrolment[emis] = int(total)

    return enrolment, stats


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
        existing.update(str(row["emis"]).strip() for row in rows if row.get("emis"))
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return existing


def _read_error_body(e):
    """Best-effort read of an HTTPError body for logging. Never includes
    request headers, so the service-role key can't leak into logs."""
    try:
        return e.read().decode("utf-8", errors="replace")[:500]
    except Exception:
        return "<no response body>"


def push_batch(supabase_url, service_key, batch, max_retries=MAX_RETRIES):
    """Upsert restricted to emis + total_enrollment only, matched via the
    UNIQUE constraint on public_schools.emis. Every emis in `batch` was
    already confirmed to exist in fetch_existing_emis(), so this can only
    ever resolve as an UPDATE of that one column — it cannot create a new
    row or touch any other field.

    Returns True on success, False on a non-retryable failure (logged,
    never raised, so one bad batch doesn't abort the whole sync)."""
    url = f"{supabase_url}/rest/v1/public_schools?on_conflict=emis"
    body = json.dumps(batch).encode("utf-8")
    last_err_summary = None

    for attempt in range(1, max_retries + 1):
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
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                r.read()
            return True
        except urllib.error.HTTPError as e:
            body_text = _read_error_body(e)
            last_err_summary = f"HTTP {e.code}: {body_text}"
            if e.code < 500 and e.code != 429:
                # Logic/schema error (e.g. bad column, missing constraint,
                # malformed row) — retrying the same batch won't help.
                print(f"ERROR: batch upsert failed permanently: {last_err_summary}", file=sys.stderr)
                return False
        except (urllib.error.URLError, TimeoutError) as e:
            last_err_summary = str(e)

        if attempt < max_retries:
            print(
                f"WARN: batch upsert attempt {attempt} failed ({last_err_summary}); retrying...",
                file=sys.stderr,
            )
            time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    print(f"ERROR: batch upsert failed after {max_retries} attempts: {last_err_summary}", file=sys.stderr)
    return False


def main():
    print("=== Enrolment Sync: starting ===")
    try:
        supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
        service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    except KeyError as e:
        print(f"FATAL: required secret/env var not set: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Source: {SIS_INDEX_URL}")
    try:
        sis_enrolment, src_stats = fetch_sis_enrolment()
    except FetchError as e:
        print(f"FATAL: could not fetch source enrolment data: {e}", file=sys.stderr)
        sys.exit(1)

    valid_emis_count = len(sis_enrolment)
    print(f"Source records read: {src_stats['source_records']}")
    print(f"Valid EMIS codes with usable enrolment: {valid_emis_count}")
    if src_stats["missing_emis"]:
        print(f"  skipped (missing EMIS): {src_stats['missing_emis']}")
    if src_stats["invalid_enrollment"]:
        print(f"  skipped (missing/invalid enrolment value): {src_stats['invalid_enrollment']}")
    if src_stats["duplicate_emis"]:
        print(f"  duplicate EMIS codes seen across districts (last value kept): {src_stats['duplicate_emis']}")
    if src_stats["districts_failed"]:
        print(f"WARN: {src_stats['districts_failed']} district file(s) could not be read — proceeding with the rest.", file=sys.stderr)

    print("Fetching existing EMIS codes from public_schools...")
    try:
        existing = fetch_existing_emis(supabase_url, service_key)
    except FetchError as e:
        print(f"FATAL: could not read public_schools from Supabase: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"  {len(existing)} schools currently in public_schools.")

    matched = [
        {"emis": emis, "total_enrollment": total}
        for emis, total in sis_enrolment.items()
        if emis in existing
    ]
    unmatched = valid_emis_count - len(matched)
    db_only = len(existing) - len(matched)

    updated = 0
    failed = 0
    for i in range(0, len(matched), BATCH_SIZE):
        batch = matched[i : i + BATCH_SIZE]
        ok = push_batch(supabase_url, service_key, batch)
        if ok:
            updated += len(batch)
        else:
            failed += len(batch)
        print(f"  processed {min(i + BATCH_SIZE, len(matched))}/{len(matched)} "
              f"(updated {updated}, failed {failed})...")
        time.sleep(0.2)

    skipped = src_stats["missing_emis"] + src_stats["invalid_enrollment"]

    print("\nEnrolment Sync Completed" if failed == 0 else "\nEnrolment Sync Completed WITH FAILURES")
    print(f"Source records: {src_stats['source_records']}")
    print(f"Valid EMIS codes: {valid_emis_count}")
    print(f"Matched public schools: {len(matched)}")
    print(f"Successfully updated: {updated}")
    print(f"Unmatched (in source, not in public_schools): {unmatched}")
    print(f"Skipped (invalid source data): {skipped}")
    print(f"Failed: {failed}")
    print(f"In public_schools but absent from this source pull: {db_only}")

    if failed > 0:
        print(f"\nFAILING build: {failed} school(s) could not be updated. See ERROR lines above.", file=sys.stderr)
        sys.exit(1)

    if updated == 0 and len(matched) > 0:
        print("\nFAILING build: no schools were updated even though matches were found.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
