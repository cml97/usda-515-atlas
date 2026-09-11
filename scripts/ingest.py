#!/usr/bin/env python3
"""
USDA Section 515 / 514 Property Atlas - data ingestion.

Reads the two published USDA Rural Development workbooks, joins them, and
writes the compact files the static site reads.

Inputs (place in data/raw/):
  USDA_RD_MFH_Active_Projects-YYYY-MM-DD.xlsx   property characteristics
  USDA_RD_MFH_Program_Exit-YYYY-MM-DD.xlsx      program exit / loan maturity
  county_fips.txt                               optional Census county crosswalk

Outputs (written to docs/data/):
  properties.json     one record per property, used by the table + detail view
  properties.geojson  same records as points, used by the map
  properties.csv      flat export for download
  meta.json           row counts, join stats, source file names, build date

Usage:
  python scripts/ingest.py
  python scripts/ingest.py --states VA,MD
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

import pandas as pd


# ---------------------------------------------------------------- helpers

def norm_col(name) -> str:
    """'Estimated Property Exit Year' -> 'estimated_property_exit_year'."""
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def find_input(raw_dir: Path, *patterns: str) -> Path:
    hits: list[Path] = []
    for pattern in patterns:
        hits.extend(raw_dir.glob(pattern))
    if not hits:
        raise SystemExit(
            f"No file matching {patterns} in {raw_dir}. Download the workbook from "
            f"https://www.sc.egov.usda.gov/data/MFH.html and save it there."
        )
    return sorted(hits)[-1]


def read_sheet(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=0, dtype=object)
    df.columns = [norm_col(c) for c in df.columns]
    return df


def blank(value) -> bool:
    return value is None or (isinstance(value, float) and math.isnan(value))


def to_text(value):
    if blank(value):
        return None
    text = str(value).strip()
    return text or None


def to_int(value):
    if blank(value):
        return None
    try:
        return int(float(str(value).strip().replace(",", "")))
    except (TypeError, ValueError):
        return None


def to_float(value):
    if blank(value):
        return None
    try:
        return float(str(value).strip().replace(",", "").replace("%", "").replace("$", ""))
    except (TypeError, ValueError):
        return None


def to_date(value):
    if blank(value):
        return None
    try:
        stamp = pd.to_datetime(value, errors="coerce")
    except Exception:
        return None
    if pd.isna(stamp):
        return None
    return stamp.date().isoformat()


def to_year(value):
    year = to_int(value)
    if year is not None and 1900 <= year <= 2100:
        return year
    iso = to_date(value)
    return int(iso[:4]) if iso else None


def to_bool(value):
    """Handles True/False, Y/N, Yes/No, 1/0, and blank-means-no indicators."""
    if blank(value):
        return None
    if isinstance(value, bool):
        return value
    head = str(value).strip()[:1].upper()
    if head in ("Y", "T", "1"):
        return True
    if head in ("N", "F", "0"):
        return False
    return None


def mfis_key(value) -> str:
    """The Project Mfis Id Key is zero-padded in both files. Canonicalize it."""
    text = to_text(value)
    if text is None:
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    return text.lstrip("0") or "0"


# ---------------------------------------------------------------- code maps
# Source: USDA Section 514/515 public data dictionary (USDA-RUR.PDF).

RENTAL_CODE = {
    "FA": "Family",
    "EL": "Elderly",
    "MX": "Mixed",
    "CG": "Congregate",
    "GH": "Group Home",
}

PROGRAM = {
    0: "Section 515 Rural Rental Housing",
    1: "Section 514 Off-Farm Labor Housing",
    2: "Section 514 On-Farm Labor Housing",
}

PROFIT_TYPE = {
    1: "Full Profit",
    2: "Limited Profit",
    3: "Non-Profit",
}


LEGACY_FIPS = {
    # Split in 2019 into Chugach (02063) and Copper River (02066).
    "02261": "Valdez-Cordova Census Area",
}


def load_counties(raw_dir: Path) -> dict:
    """FIPS -> county name lookup from data/raw/county_fips.txt.

    Two formats are accepted:

    1. The compact form this repo ships: five-digit FIPS followed by the name,
       where a leading "~" means the name is complete as written and anything
       else has had the word "County" trimmed off the end.
         01001Autauga            -> Autauga County
         22001~Acadia Parish     -> Acadia Parish
    2. The raw Census pipe-delimited file, if you prefer to drop that in:
       https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt

    Missing file is fine. County names are then blank and the site falls back
    to showing the FIPS code.
    """
    path = raw_dir / "county_fips.txt"
    if not path.exists():
        return {}

    lookup: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.rstrip("\n")
        if not line.strip():
            continue

        if "|" in line:
            parts = line.split("|")
            if len(parts) < 5 or parts[1].strip().upper() == "STATEFP":
                continue
            lookup[f"{parts[1].strip()}{parts[2].strip()}"] = parts[4].strip()
            continue

        if len(line) < 6 or not line[:5].isdigit():
            continue
        fips, name = line[:5], line[5:].strip()
        lookup[fips] = name[1:] if name.startswith("~") else f"{name} County"

    # Retired FIPS codes that still appear in USDA's files. Census dropped them,
    # so they are not in the crosswalk, but the properties are still real.
    for fips, name in LEGACY_FIPS.items():
        lookup.setdefault(fips, name)

    return lookup


# ---------------------------------------------------------------- build

def build_exit_lookup(exit_df: pd.DataFrame) -> dict:
    """One record per property from the exit file.

    The published file is already property level (one row per project), but a
    duplicate key would silently drop data, so anything that repeats is folded
    together: latest maturity wins for exit timing, earliest year wins for
    prepayment eligibility.
    """
    records: dict[str, dict] = {}

    for _, row in exit_df.iterrows():
        key = mfis_key(row.get("project_mfis_id_key"))
        if not key:
            continue

        rec = records.get(key)
        if rec is None:
            rec = records[key] = {
                "row_count": 0,
                "exit_year": None,
                "exit_date": None,
                "loan_payoff_year": None,
                "prepay_eligible_year": None,
                "prepay_eligible_now": None,
                "natural_maturity": None,
                "upb_maturity": None,
                "orig_loan_term": None,
                "remaining_term_days": None,
                "interest_rate": None,
                "loan_amt": None,
                "balloon": None,
                "borrower_name": None,
                "borrower_type": None,
                "borrower_city_state": None,
                "fy_loan_obligation": None,
                "program_label": None,
                "restrictive_clause_year": None,
                "report_date": None,
            }
        rec["row_count"] += 1

        rules = (
            ("exit_year", "estimated_property_exit_year", to_year, max),
            ("loan_payoff_year", "loan_payoff_year", to_year, max),
            ("prepay_eligible_year", "prepay_eligible_date_yr", to_year, min),
            ("restrictive_clause_year", "year_restrictive_clause_expires", to_year, max),
            ("exit_date", "estimated_property_exit_date", to_date, max),
            ("natural_maturity", "natural_maturity", to_date, max),
            ("upb_maturity", "upb_maturity", to_date, max),
            ("orig_loan_term", "orig_loan_term", to_float, max),
            ("remaining_term_days", "remaining_term_days", to_float, max),
            ("interest_rate", "interest_rate_at_loan_closing", to_float, min),
            ("loan_amt", "loan_amt", to_float, max),
        )
        for field, source, cast, pick in rules:
            value = cast(row.get(source))
            if value is None:
                continue
            rec[field] = value if rec[field] is None else pick(rec[field], value)

        for field, source in (("balloon", "balloon_pmt_ind"), ("prepay_eligible_now", "prepay_eligible")):
            flag = to_bool(row.get(source))
            if flag is not None:
                rec[field] = bool(rec[field]) or flag if rec[field] is not None else flag

        for field, source in (
            ("borrower_name", "borrower_name"),
            ("borrower_type", "borrower_type"),
            ("borrower_city_state", "borrower_city_state"),
            ("program_label", "rural_housing_labor_housing_section_of_housing_act"),
        ):
            if rec[field] is None:
                rec[field] = to_text(row.get(source))

        if rec["fy_loan_obligation"] is None:
            rec["fy_loan_obligation"] = to_int(row.get("fy_of_loan_obligation"))
        if rec["report_date"] is None:
            rec["report_date"] = to_date(row.get("report_date"))

    return records


def build_properties(prop_df: pd.DataFrame, exits: dict, counties: dict, today: dt.date) -> list[dict]:
    out: list[dict] = []

    for _, row in prop_df.iterrows():
        key = mfis_key(row.get("project_mfis_id_key"))
        if not key:
            continue

        fips = to_text(row.get("state_county_fips_code"))
        if fips and fips.replace(".0", "").isdigit():
            fips = fips.replace(".0", "").zfill(5)

        beds = {str(n): to_int(row.get(f"total_{n}_bedroom_units")) or 0 for n in range(1, 7)}
        ra_units = to_int(row.get("rental_assistance_units")) or 0
        total_units = to_int(row.get("project_size"))
        program_code = to_int(row.get("labor_housing_type"))
        rental_code = (to_text(row.get("rental_code")) or "").upper()

        address = " ".join(
            part for part in (
                to_text(row.get("main_address_line1")),
                to_text(row.get("main_address_line2")),
                to_text(row.get("main_address_line3")),
            ) if part
        ) or None

        ex = exits.get(key, {})
        exit_year = ex.get("exit_year")
        lihtc_expires = to_date(row.get("date_tax_credit_expires"))

        record = {
            "id": key,
            "borrower_id": to_text(row.get("borrower_id")),
            "project_id": to_text(row.get("project_id")),
            "check_digit": to_text(row.get("project_check_digit")),

            "name": to_text(row.get("project_name")),
            "address": address,
            "city": to_text(row.get("city")),
            "state": to_text(row.get("state_abbreviation")),
            "zip": to_text(row.get("zip_code")),
            "fips": fips,
            "county": counties.get(fips) if fips else None,
            "lat": to_float(row.get("latitude")),
            "lon": to_float(row.get("longitude")),

            "program_code": program_code,
            "program": PROGRAM.get(program_code) or ex.get("program_label"),
            "rental_code": rental_code if rental_code in RENTAL_CODE else None,
            "rental_type": RENTAL_CODE.get(rental_code),
            "profit_type": PROFIT_TYPE.get(to_int(row.get("profit_type_code"))),
            "management": to_text(row.get("management_name")),
            "borrower_name": ex.get("borrower_name"),
            "borrower_type": ex.get("borrower_type"),
            "borrower_city_state": ex.get("borrower_city_state"),
            "date_of_operation": to_date(row.get("date_of_operation")),
            "revitalized": to_int(row.get("revitilization_indicator")) == 1,

            "units": total_units,
            "beds": beds,
            "handicapped_units": to_int(row.get("total_handicapped_units")),
            "vacant_units": to_int(row.get("vacant_units")),
            "ra_units": ra_units,
            "ra_share": round(ra_units / total_units, 4) if total_units else None,

            "lihtc": to_bool(row.get("tax_status_indicator")),
            "lihtc_expires": lihtc_expires,
            "lihtc_expiry_year": int(lihtc_expires[:4]) if lihtc_expires else None,
            "restrictive_clause_expires": to_date(row.get("date_restrictive_clause_expires")),
            "restrictive_clause_year": ex.get("restrictive_clause_year"),

            "exit_year": exit_year,
            "exit_date": ex.get("exit_date"),
            "loan_payoff_year": ex.get("loan_payoff_year"),
            "prepay_eligible_year": ex.get("prepay_eligible_year"),
            "prepay_eligible_now": ex.get("prepay_eligible_now"),
            "natural_maturity": ex.get("natural_maturity"),
            "upb_maturity": ex.get("upb_maturity"),
            "orig_loan_term": ex.get("orig_loan_term"),
            "remaining_term_days": ex.get("remaining_term_days"),
            "interest_rate": ex.get("interest_rate"),
            "loan_amt": ex.get("loan_amt"),
            "balloon": ex.get("balloon"),
            "fy_loan_obligation": ex.get("fy_loan_obligation"),
            "has_exit_data": bool(ex),
            "years_to_exit": (exit_year - today.year) if exit_year else None,
        }

        out.append(record)

    out.sort(key=lambda r: ((r["state"] or "ZZ"), (r["name"] or "")))
    return out


INDEX_FIELDS = (
    "id", "name", "city", "county", "state", "fips", "lat", "lon",
    "program_code", "rental_code", "units", "ra_units", "ra_share",
    "lihtc", "lihtc_expiry_year", "exit_year", "years_to_exit",
    "prepay_eligible_now", "management",
)


def write_outputs(records: list[dict], out_dir: Path, meta: dict) -> None:
    """Write a slim index the site loads up front, plus per-state detail shards.

    The full record set is about 15 MB, which is too much to pull on every page
    view. The table and map run off index.json; the detail panel fetches only
    the state shard it needs and caches it.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    shard_dir = out_dir / "by-state"
    shard_dir.mkdir(parents=True, exist_ok=True)
    for stale in shard_dir.glob("*.json"):
        stale.unlink()

    index = [{k: r[k] for k in INDEX_FIELDS} for r in records]
    (out_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    shards: dict[str, list] = {}
    for r in records:
        shards.setdefault((r["state"] or "ZZ").upper(), []).append(r)
    for state, rows in shards.items():
        (shard_dir / f"{state}.json").write_text(
            json.dumps({r["id"]: r for r in rows}, separators=(",", ":")), encoding="utf-8"
        )

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {k: r[k] for k in (
                "id", "name", "city", "state", "county", "units", "ra_units",
                "exit_year", "years_to_exit", "lihtc", "program", "rental_type",
            )},
        }
        for r in records
        if r["lat"] is not None and r["lon"] is not None
    ]
    (out_dir / "properties.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")),
        encoding="utf-8",
    )

    flat_cols = [
        "id", "name", "address", "city", "county", "state", "zip", "fips", "lat", "lon",
        "program", "rental_type", "profit_type", "management", "borrower_name", "borrower_type",
        "units", "ra_units", "ra_share", "vacant_units", "handicapped_units",
        "lihtc", "lihtc_expires", "restrictive_clause_expires",
        "exit_year", "years_to_exit", "loan_payoff_year", "prepay_eligible_year",
        "prepay_eligible_now", "natural_maturity", "upb_maturity", "loan_amt",
        "interest_rate", "orig_loan_term", "date_of_operation",
    ]
    with (out_dir / "properties.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=flat_cols, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)

    counties = {r["fips"]: r["county"] for r in records if r["fips"] and r["county"]}
    (out_dir / "counties.json").write_text(json.dumps(counties, separators=(",", ":")), encoding="utf-8")

    meta["shard_count"] = len(shards)
    meta["county_names_resolved"] = len(counties)
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", default="data/raw")
    parser.add_argument("--out-dir", default="docs/data")
    parser.add_argument("--states", default="", help="comma-separated states to keep, e.g. VA,MD")
    args = parser.parse_args()

    raw_dir, out_dir = Path(args.raw_dir), Path(args.out_dir)
    today = dt.date.today()

    prop_path = find_input(raw_dir, "*Active_Projects*.xlsx")
    exit_path = find_input(raw_dir, "*Program_Exit*.xlsx")
    print(f"property file : {prop_path.name}")
    print(f"exit file     : {exit_path.name}")

    prop_df = read_sheet(prop_path)
    exit_df = read_sheet(exit_path)
    print(f"property rows : {len(prop_df):,}   exit rows: {len(exit_df):,}")

    counties = load_counties(raw_dir)
    print(f"county lookup : {len(counties):,} entries" if counties
          else "county lookup : none (add data/raw/county_fips.txt for county names)")

    exits = build_exit_lookup(exit_df)
    records = build_properties(prop_df, exits, counties, today)

    if args.states:
        wanted = {s.strip().upper() for s in args.states.split(",") if s.strip()}
        records = [r for r in records if (r["state"] or "").upper() in wanted]
        print(f"filtered to   : {sorted(wanted)}")

    matched = sum(1 for r in records if r["has_exit_data"])
    geocoded = sum(1 for r in records if r["lat"] is not None and r["lon"] is not None)
    with_exit = sum(1 for r in records if r["exit_year"])
    horizon = today.year + 10

    meta = {
        "built": today.isoformat(),
        "source_property_file": prop_path.name,
        "source_exit_file": exit_path.name,
        "property_report_date": to_date(prop_df["report_date"].iloc[0]) if "report_date" in prop_df else None,
        "exit_report_date": to_date(exit_df["report_date"].iloc[0]) if "report_date" in exit_df else None,
        "property_count": len(records),
        "exit_records_in_source": len(exits),
        "joined_count": matched,
        "join_rate": round(matched / len(records), 4) if records else 0,
        "geocoded_count": geocoded,
        "with_exit_year": with_exit,
        "exiting_within_10_years": sum(1 for r in records if r["exit_year"] and r["exit_year"] <= horizon),
        "total_units": sum(r["units"] or 0 for r in records),
        "total_ra_units": sum(r["ra_units"] or 0 for r in records),
        "lihtc_count": sum(1 for r in records if r["lihtc"]),
        "has_county_names": bool(counties),
        "states": sorted({r["state"] for r in records if r["state"]}),
        "programs": sorted({r["program"] for r in records if r["program"]}),
    }

    write_outputs(records, out_dir, meta)

    print(f"properties    : {meta['property_count']:,}")
    print(f"joined to exit: {matched:,} ({meta['join_rate']:.1%})")
    print(f"with lat/lon  : {geocoded:,}")
    print(f"with exit year: {with_exit:,}   exiting by {horizon}: {meta['exiting_within_10_years']:,}")
    print(f"total units   : {meta['total_units']:,}   RA units: {meta['total_ra_units']:,}")
    print(f"wrote -> {out_dir}/index.json, by-state/*.json, properties.csv, properties.geojson, meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
