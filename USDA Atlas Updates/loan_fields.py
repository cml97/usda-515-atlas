"""Correct loan term, amortization and maturity for a USDA 515 property record.

Why this exists
---------------
The export carries two different dates and they are easy to confuse.

    Natural Maturity   the note's final installment, which is where a balloon lands
    UPB Maturity       the date the amortization schedule reaches zero

On a note that amortizes over a longer period than its term, those are years apart.
Stevens Woods runs a 30 year term against a 50 year amortization, so its natural
maturity is 2041 and its UPB maturity is 2061. Loan Payoff Year is currently computed
off UPB Maturity, which makes it twenty years long on that property. Remaining Term
(Days) is anchored to the same date and is long by the same gap.

Both dates run from the same start, so the amortization period falls out of them:

    amortization = Original Loan Term + (UPB Maturity - Natural Maturity)

That was checked against every property we hold loan documents for. It returns 33 years
on the six California Section 514 notes, which is the 396 installments their audits
state, and 50 years on Oakridge and Stevens Woods, which is what their notes say. Villa
Dorada returns 33 with no balloon, and its UPB maturity falls before its natural
maturity, which is what a note that amortizes out early looks like.

Nothing here needs a new data source. It is all arithmetic on fields the file already
has.
"""

from datetime import date, datetime

DAYS_PER_YEAR = 365.25


def _as_date(value):
    """A date out of the data file, which writes them as YYYY-MM-DD, as a datetime, or
    as a date. Anything else comes back as None rather than raising, because one bad
    row should not stop a build of thirteen thousand properties."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value)[:10]
    try:
        return date(int(text[0:4]), int(text[5:7]), int(text[8:10]))
    except (ValueError, IndexError):
        return None


def loan_fields(record):
    """Return the corrected loan fields for one property.

    `record` is the property dict as the pipeline already builds it. Reads
    natural_maturity, upb_maturity, orig_loan_term and rate_at_closing. Returns a dict
    to merge in. Every value is None where the inputs do not support it, so a property
    with no loan data comes back empty rather than wrong.
    """
    natural = _as_date(record.get("natural_maturity"))
    upb = _as_date(record.get("upb_maturity"))

    term = record.get("orig_loan_term")
    try:
        term = float(term) if term not in (None, "") else None
    except (TypeError, ValueError):
        term = None

    amortization = None
    if natural and upb and term is not None:
        amortization = round(term + (upb - natural).days / DAYS_PER_YEAR)

    balloons = None
    if natural and upb:
        # A note whose schedule reaches zero on or before its final installment pays
        # itself off. Anything later leaves a balance due in one payment.
        balloons = upb > natural

    remaining = None
    if natural:
        remaining = (natural - date.today()).days

    rate = record.get("rate_at_closing")
    try:
        # Stored as a percent in the file. The balloon has to be computed on the note
        # rate, not on the rate the borrower pays after interest credit.
        note_rate = float(rate) / 100.0 if rate not in (None, "") else None
    except (TypeError, ValueError):
        note_rate = None

    return {
        "loan_payoff_year": natural.year if natural else None,
        "amortization_end_year": upb.year if upb else None,
        "amortization_years": amortization,
        "remaining_term_days": remaining,
        "has_balloon": balloons,
        "note_rate": note_rate,
    }


def apply_loan_fields(records):
    """Merge the corrected fields into every record in place and return the list."""
    for record in records:
        record.update(loan_fields(record))
    return records


if __name__ == "__main__":
    # The eight properties we hold loan documents for, as a self test. Run this file
    # directly and it should print eight passes.
    cases = [
        ("Stevens Woods",       30, "2041-10-09", "2061-09-24", 50, True),
        ("Cesar Chavez II",     30, "2048-07-12", "2051-06-19", 33, True),
        ("Cesar Chavez Villas", 30, "2044-01-20", "2046-12-21", 33, True),
        ("Las Palmeras",        30, "2045-08-20", "2048-07-21", 33, True),
        ("Oakridge",            30, "2041-06-23", "2061-06-13", 50, True),
        ("Villa Del Sol",       30, "2041-08-17", "2044-07-23", 33, True),
        ("Villa Dorada",        33, "2040-07-21", "2040-05-13", 33, False),
        ("Villa Fortuna",       30, "2041-08-17", "2044-07-23", 33, True),
    ]
    failures = 0
    for name, term, natural, upb, expected_am, expected_balloon in cases:
        got = loan_fields({
            "orig_loan_term": term,
            "natural_maturity": natural,
            "upb_maturity": upb,
        })
        ok = got["amortization_years"] == expected_am and got["has_balloon"] == expected_balloon
        failures += 0 if ok else 1
        print(f"{'pass' if ok else 'FAIL'}  {name:22} "
              f"term {term:>2}  amortization {got['amortization_years']:>3}  "
              f"payoff {got['loan_payoff_year']}  balloon {got['has_balloon']}")
    print(f"\n{len(cases) - failures} of {len(cases)} passed")
