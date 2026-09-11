# USDA Section 515 Property Atlas

A static, searchable atlas of every active property in USDA Rural Development's
multifamily portfolio: Section 515 Rural Rental Housing plus Section 514 Farm
Labor Housing. Table, map, and per-property detail, with the program exit year
surfaced so the maturing-mortgage wave is visible at a glance.

Built entirely from USDA's published open data. No backend, no paid services.

## What is in here

```
docs/                     the website, served by GitHub Pages
  index.html              table page with filters and CSV export
  map.html                clustered map, colored by exit horizon
  about.html              data sources, caveats, how to read the exit year
  assets/                 stylesheet and scripts
  data/                   generated, do not edit by hand
    index.json            slim record per property, loaded by both pages
    by-state/XX.json      full detail, fetched on demand per state
    properties.csv        full joined dataset
    properties.geojson    full joined dataset as points
    meta.json             build date, row counts, join rate
scripts/
  fetch_data.py           downloads the current USDA workbooks into data/raw/
  ingest.py               joins them and writes everything under docs/data/
data/raw/                 the source workbooks (not committed)
.github/workflows/        monthly refresh
```

## Data sources

| What | Where |
|---|---|
| Property characteristics | https://www.sc.egov.usda.gov/data/MFH_section_515.html (Active Projects) |
| Property data dictionary | https://www.sc.egov.usda.gov/data/files/MFH_Section_515/ActiveProjects/USDA-RUR.PDF |
| Program exit data | https://www.sc.egov.usda.gov/data/MFH.html (Program Exit Data) |
| Exit data dictionary | https://www.sc.egov.usda.gov/data/files/MFH/USDA%20Multifamily%20Housing%20Program%20Exit%20Data_Data%20Dictionary-May%202023.pdf |

USDA stamps the as-of date into each filename and changes it a few times a year,
so `fetch_data.py` reads the index page and takes the newest matching link rather
than hitting a fixed URL. The data.gov catalog entries for these datasets point
at files from 2016 and 2017 and should not be used.

The two files join on USDA's MFIS project key (borrower number, project number,
and check digit combined), which both files carry. Current match rate is 99.6%.

## Rebuilding the data locally

```
pip install -r requirements.txt
python scripts/fetch_data.py
python scripts/ingest.py
```

`ingest.py` prints the row counts, join rate, and totals so a bad refresh is
obvious. To test on a subset:

```
python scripts/ingest.py --states VA,MD
```

### County names

USDA gives the county as a five-digit FIPS code with no name. To get real county
names in the table and the county filter, save the Census crosswalk as
`data/raw/county_fips.txt` and rerun `ingest.py`:

https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt

Without it, the county column falls back to the FIPS code. Nothing else changes.

## Previewing the site locally

```
cd docs
python -m http.server 8000
```

Then open http://localhost:8000 in a browser. Opening the HTML files directly
from disk will not work, because the pages fetch their data over HTTP.

## Automatic refresh

`.github/workflows/refresh.yml` runs on the first of each month, downloads the
current USDA workbooks, rebuilds `docs/data`, and commits the result only if
something actually changed. It can also be run on demand from the Actions tab.

## License and reuse

The source data is federal open data in the public domain. The code here is
free to reuse.
