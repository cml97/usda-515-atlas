"""Pull HUD Fair Market Rents into the atlas.

What this gives you
-------------------
Fair market rent by bedroom size for every property, so the atlas can show how far
under the market standard a property's rents sit. FMR is a gross standard that assumes
the tenant pays utilities, so a fair comparison adds the utility allowance to basic rent
before dividing. The model book does that already and expects the raw FMR here.

Getting a token
---------------
HUD requires a free token. Register at huduser.gov, open your account page, create an
access token and copy it. It is a long string. Put it in the environment as
HUD_API_TOKEN. The token expires, so if the build starts failing with 401 that is the
first thing to check.

Rate limits
-----------
HUD allows a limited number of calls per minute per token. This module caches by FMR
area rather than by property, which matters: a thousand properties in the same county
cost one call, not a thousand. Run it over a full national file and expect a few
thousand calls, so leave the delay at its default rather than turning it down.

A note on what has not been verified
------------------------------------
This was written against HUD's documented response shape but could not be run against
the live endpoint from the environment it was written in, which blocks huduser.gov. Run
`python3 hud_fmr.py --selftest` to check the parsing against a recorded response, then
`python3 hud_fmr.py --county 51175 --year 2026` to make one real call before wiring it
into a build.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://www.huduser.gov/hudapi/public/fmr"
BEDROOM_KEYS = {
    "Efficiency": "0",
    "One-Bedroom": "1",
    "Two-Bedroom": "2",
    "Three-Bedroom": "3",
    "Four-Bedroom": "4",
}


class FmrError(RuntimeError):
    pass


def entity_id(county_fips):
    """HUD wants a ten character entity id for a county, which is the five digit FIPS
    followed by five nines. 51175 becomes 5117599999."""
    fips = str(county_fips).strip().zfill(5)
    if len(fips) != 5 or not fips.isdigit():
        raise FmrError(f"county FIPS should be five digits, got {county_fips!r}")
    return fips + "99999"


def _request(url, token, attempts=4, delay=1.0):
    """One GET with backoff. HUD answers 429 when the token is going too fast, and that
    is worth waiting out rather than failing a whole build over."""
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    last = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last = error
            if error.code == 401:
                raise FmrError("HUD rejected the token. Check HUD_API_TOKEN has not expired.")
            if error.code == 404:
                return None
            if error.code in (429, 500, 502, 503, 504):
                time.sleep(delay * (2 ** attempt))
                continue
            raise FmrError(f"HUD returned {error.code} for {url}") from error
        except urllib.error.URLError as error:
            last = error
            time.sleep(delay * (2 ** attempt))
    raise FmrError(f"HUD did not answer after {attempts} tries: {last}")


def parse(payload):
    """Pull the bedroom rents out of a response.

    HUD answers in two shapes. A non metro county returns one set of rents as a dict.
    A metro area with small area FMRs in force returns a list, one entry per ZIP. This
    returns the area figures either way, and the per ZIP figures alongside them when
    they are there, because a property's own ZIP is the better number when it exists.
    """
    if not payload:
        return None
    data = payload.get("data") or {}
    basic = data.get("basicdata")
    if basic is None:
        return None

    def rents(block):
        out = {}
        for hud_name, bedrooms in BEDROOM_KEYS.items():
            value = block.get(hud_name)
            if value not in (None, ""):
                try:
                    out[bedrooms] = int(round(float(value)))
                except (TypeError, ValueError):
                    pass
        return out

    by_zip = {}
    if isinstance(basic, list):
        # Small area. Every entry is one ZIP. HUD does not repeat the area wide figures
        # in this shape, so the area number is the median across its ZIPs, which is
        # what HUD's own documentation describes as the area rent for these.
        for entry in basic:
            zip_code = str(entry.get("zip_code") or "").zfill(5)
            if zip_code and zip_code != "00000":
                by_zip[zip_code] = rents(entry)
        area = {}
        for bedrooms in BEDROOM_KEYS.values():
            values = sorted(v[bedrooms] for v in by_zip.values() if bedrooms in v)
            if values:
                area[bedrooms] = values[len(values) // 2]
    else:
        area = rents(basic)

    return {
        "area_name": data.get("counties_msa") or data.get("metro_name") or data.get("county_name"),
        "small_area": str(data.get("smallarea_status") or "0") == "1",
        "by_bedroom": area,
        "by_zip": by_zip,
    }


class FmrClient:
    """Caches by FMR area, so a county is fetched once however many properties sit in
    it. Pass `delay` up if HUD starts throttling."""

    def __init__(self, token=None, year=None, delay=0.35):
        self.token = token or os.environ.get("HUD_API_TOKEN")
        if not self.token:
            raise FmrError("No HUD token. Set HUD_API_TOKEN or pass token=.")
        self.year = year
        self.delay = delay
        self._cache = {}
        self.calls = 0

    def county(self, county_fips, year=None):
        year = year or self.year
        key = (str(county_fips), year)
        if key in self._cache:
            return self._cache[key]
        url = f"{BASE}/data/{entity_id(county_fips)}"
        if year:
            url += f"?year={year}"
        payload = _request(url, self.token)
        self.calls += 1
        time.sleep(self.delay)
        result = parse(payload)
        if result:
            result["year"] = year
            result["county_fips"] = str(county_fips).zfill(5)
        self._cache[key] = result
        return result

    def for_property(self, record, year=None):
        """FMR for one property record. Uses the property's own ZIP where the area
        publishes small area rents, and the area figures otherwise."""
        fips = record.get("county_fips") or record.get("fips")
        if not fips:
            return None
        area = self.county(fips, year)
        if not area:
            return None
        zip_code = str(record.get("zip") or record.get("zip_code") or "").zfill(5)
        by_bedroom = area["by_bedroom"]
        basis = "area"
        if area["small_area"] and zip_code in area["by_zip"]:
            by_bedroom = area["by_zip"][zip_code]
            basis = "zip"
        return {
            "fmr_year": area.get("year"),
            "fmr_area": area["area_name"],
            "fmr_basis": basis,
            "fmr_small_area": area["small_area"],
            "fmr_by_bedroom": by_bedroom,
        }


def apply_fmr(records, token=None, year=None, delay=0.35):
    """Merge FMR into every record in place. Returns the list and prints how many calls
    it took, which is the number worth watching against HUD's rate limit."""
    client = FmrClient(token=token, year=year, delay=delay)
    missing = 0
    for record in records:
        result = client.for_property(record)
        if result:
            record.update(result)
        else:
            missing += 1
    print(f"FMR: {client.calls} HUD calls for {len(records)} properties, "
          f"{missing} without a match", file=sys.stderr)
    return records


# ------------------------------------------------------------------ self test

RECORDED_NONMETRO = {
    "data": {
        "county_name": "Southampton County",
        "counties_msa": "Southampton County-Franklin city, VA HUD Nonmetro FMR Area",
        "smallarea_status": "0",
        "basicdata": {
            "Efficiency": 860, "One-Bedroom": 870, "Two-Bedroom": 1120,
            "Three-Bedroom": 1440, "Four-Bedroom": 1880,
        },
    }
}

RECORDED_SMALLAREA = {
    "data": {
        "county_name": "Dallas County",
        "metro_name": "Dallas, TX HUD Metro FMR Area",
        "smallarea_status": "1",
        "basicdata": [
            {"zip_code": "75201", "Efficiency": 1500, "One-Bedroom": 1600,
             "Two-Bedroom": 1900, "Three-Bedroom": 2400, "Four-Bedroom": 3000},
            {"zip_code": "75206", "Efficiency": 1200, "One-Bedroom": 1300,
             "Two-Bedroom": 1600, "Three-Bedroom": 2100, "Four-Bedroom": 2600},
            {"zip_code": "75210", "Efficiency": 900, "One-Bedroom": 1000,
             "Two-Bedroom": 1200, "Three-Bedroom": 1500, "Four-Bedroom": 1900},
        ],
    }
}


def _selftest():
    ok = True
    a = parse(RECORDED_NONMETRO)
    expect = {"0": 860, "1": 870, "2": 1120, "3": 1440, "4": 1880}
    if a["by_bedroom"] != expect or a["small_area"] or a["by_zip"]:
        ok = False
        print("FAIL non metro parse", a)
    else:
        print("pass  non metro county parses to", a["by_bedroom"])

    b = parse(RECORDED_SMALLAREA)
    if not b["small_area"] or b["by_zip"]["75206"]["2"] != 1600 or b["by_bedroom"]["2"] != 1600:
        ok = False
        print("FAIL small area parse", b)
    else:
        print("pass  small area parses", len(b["by_zip"]), "ZIPs, area 2BR", b["by_bedroom"]["2"])

    if entity_id("51175") != "5117599999" or entity_id(6025) != "0602599999":
        ok = False
        print("FAIL entity id")
    else:
        print("pass  entity id 51175 ->", entity_id("51175"))

    print("\nself test passed" if ok else "\nSELF TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--selftest" in args:
        sys.exit(_selftest())
    if "--county" in args:
        fips = args[args.index("--county") + 1]
        year = args[args.index("--year") + 1] if "--year" in args else None
        client = FmrClient(year=year)
        print(json.dumps(client.county(fips), indent=2))
        sys.exit(0)
    print(__doc__)
    print("Usage:\n  python3 hud_fmr.py --selftest"
          "\n  python3 hud_fmr.py --county 51175 --year 2026")
