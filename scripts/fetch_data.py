#!/usr/bin/env python3
"""
Download the current USDA multifamily workbooks into data/raw/.

USDA stamps the as-of date into each filename, so there is no fixed URL to hit.
This reads the two index pages, finds the newest matching link on each, and
downloads it. Run this before scripts/ingest.py.

Usage:
  python scripts/fetch_data.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

BASE = "https://www.sc.egov.usda.gov/data/"

PAGES = {
    "property": (BASE + "MFH_section_515.html", re.compile(r"Active_Projects-\d{4}-\d{2}-\d{2}\.xlsx", re.I)),
    "exit": (BASE + "MFH.html", re.compile(r"Program_Exit-\d{4}-\d{2}-\d{2}\.xlsx", re.I)),
}

HEADERS = {"User-Agent": "usda-515-atlas/1.0 (open data ingestion)"}


def get(url: str) -> bytes:
    with urlopen(Request(url, headers=HEADERS), timeout=120) as response:
        return response.read()


def newest_link(page_url: str, pattern: re.Pattern) -> str:
    html = get(page_url).decode("utf-8", errors="replace")
    hrefs = re.findall(r'href\s*=\s*["\']([^"\']+)["\']', html, re.I)
    matches = [h for h in hrefs if pattern.search(h)]
    if not matches:
        raise SystemExit(f"No link matching {pattern.pattern} found on {page_url}")
    return urljoin(page_url, sorted(matches)[-1])


def main() -> int:
    raw_dir = Path("data/raw")
    raw_dir.mkdir(parents=True, exist_ok=True)

    for label, (page_url, pattern) in PAGES.items():
        url = newest_link(page_url, pattern)
        name = url.rsplit("/", 1)[-1].replace("%20", "_")
        target = raw_dir / name

        if target.exists():
            print(f"{label:9s} already current: {name}")
            continue

        print(f"{label:9s} downloading {name}")
        target.write_bytes(get(url))
        print(f"{label:9s} saved {target} ({target.stat().st_size:,} bytes)")

        for stale in raw_dir.glob(pattern.pattern.split("-")[0] + "*"):
            if stale != target and stale.suffix.lower() == ".xlsx":
                stale.unlink()
                print(f"{label:9s} removed superseded {stale.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
