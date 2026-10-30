# USDA 515 Atlas, loan fields and HUD FMR

Two changes, both for the data repo at `github.com/cml97/usda-515-data`. The site repo
is not touched.

Everything in this folder has been tested except the live HUD call, which could not be
made from where the code was written. Step 7 is the one that proves it.

---

## What is wrong today, in one paragraph

The file carries two different dates for every loan. **Natural Maturity** is the note's
final installment, which is where a balloon lands. **UPB Maturity** is the date the
amortization schedule reaches zero. On a note that amortizes over a longer period than
its term those are years apart. Stevens Woods runs a 30 year term against a 50 year
amortization, so its natural maturity is 2041 and its UPB maturity is 2061. Loan Payoff
Year is computed off the wrong one of those two, which makes it twenty years long on
that property, and Remaining Term is long by the same gap. Five of the seven California
properties are three years long for the same reason, and none of them show the balloon
they actually have.

---

## Before you start

You need to be signed in to GitHub as cml97, and you need a HUD API token.

**Getting the HUD token.** Go to huduser.gov and sign in, or register if you have not.
Open your account page and look for API access tokens. Create one. It is a long string
of letters and numbers. Copy it somewhere safe now, because HUD shows it once.

---

## Step 1, open the data repo

Go to `github.com/cml97/usda-515-data`.

If you see a 404, you are signed in as the wrong account or signed out. Check the
avatar at the top right.

---

## Step 2, upload the two files

Click **Add file** at the top right of the file list, then **Upload files**.

Drag `loan_fields.py` and `hud_fmr.py` from this folder into the box.

Under **Commit changes** at the bottom, put `Add loan field and HUD FMR modules` in the
message box. Leave **Commit directly to the main branch** selected. Click **Commit
changes**.

Both files land at the top level of the repo, which is where the rest of the pipeline
scripts live.

---

## Step 3, find where properties get built

In the file list, press `t`. That opens the file finder. Type `.py` and look at what
comes back, then open whichever script builds the property records. It will be the one
that mentions `loan_payoff_year`.

If you cannot tell which one, use search instead. Click the search box at the top of
the repo page, type `loan_payoff_year`, and press enter. GitHub will show every line
that mentions it. The file you want is the one where it is being **set**, not just read.

---

## Step 4, call the new loan code

Open that file. Click the pencil icon to edit.

At the top, with the other imports, add:

```python
from loan_fields import apply_loan_fields
```

Then find the point where the list of property records is finished and about to be
written out. Just before it is written, add:

```python
apply_loan_fields(records)
```

Use whatever the list is actually called in that file. If it is `properties` rather
than `records`, write `apply_loan_fields(properties)`.

Commit with the message `Derive loan payoff and amortization from natural maturity`.

### What that changes

| Field | Before | After |
|---|---|---|
| `loan_payoff_year` | year of UPB Maturity | year of Natural Maturity |
| `remaining_term_days` | counted to UPB Maturity | counted to Natural Maturity |
| `amortization_years` | did not exist | term plus the gap between the two dates |
| `has_balloon` | did not exist | true when the schedule outlives the term |
| `note_rate` | did not exist | Rate at Closing as a decimal |
| `amortization_end_year` | did not exist | year of UPB Maturity, kept under its real name |

Nothing is deleted. UPB Maturity keeps its own field, it just stops being called a
payoff.

---

## Step 5, store the HUD token as a secret

Never paste the token into a file. It goes in GitHub's secret store instead.

1. On the repo page, click **Settings**, at the far right of the tab row.
2. In the left sidebar, click **Secrets and variables**, then **Actions**.
3. Click the green **New repository secret**.
4. Name it exactly `HUD_API_TOKEN`. Capital letters and underscores, no spaces.
5. Paste the token into the Secret box.
6. Click **Add secret**.

You will not be able to read it back afterwards, which is the point.

---

## Step 6, make the refresh use it

Open `.github/workflows/` and then the monthly refresh workflow file. Click the pencil
to edit.

Find the step that runs the build. It will have a `run:` line. Directly under that
step's `run:` block, at the same indentation as `run:`, add:

```yaml
        env:
          HUD_API_TOKEN: ${{ secrets.HUD_API_TOKEN }}
```

YAML cares about indentation, so line up `env:` with the `run:` above it rather than
guessing. If GitHub shows a red mark in the margin after you paste, the indentation is
off by a space or two.

Commit with the message `Pass the HUD token to the build`.

---

## Step 7, prove the token works before wiring FMR in

This is the step that catches a bad token, and it takes a minute.

On the repo page click **Actions**, then **New workflow**, then **set up a workflow
yourself**. Replace everything in the editor with:

```yaml
name: FMR token check
on: workflow_dispatch
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: python3 hud_fmr.py --selftest
      - run: python3 hud_fmr.py --county 51175 --year 2026
        env:
          HUD_API_TOKEN: ${{ secrets.HUD_API_TOKEN }}
```

Name the file `fmr-check.yml` and commit it.

Now click **Actions** in the tab row, pick **FMR token check** in the left sidebar,
click **Run workflow** on the right, then the green **Run workflow** button.

Wait for it to finish and click into the run. Open the last step.

- **You want to see** Southampton County rents printed out, around $870 for a one
  bedroom and $1,120 for a two bedroom on FY2026.
- **"HUD rejected the token"** means the token is wrong or expired. Make a new one and
  redo step 5.
- **A 429** means the token is being throttled. Wait a few minutes and run it again.

Once it passes, delete `fmr-check.yml` the same way you added it. It has done its job.

---

## Step 8, call the FMR code

Only after step 7 passes.

Open the same script you edited in step 4. Add to the imports:

```python
from hud_fmr import apply_fmr
```

And next to the `apply_loan_fields` line you added:

```python
apply_fmr(records, year=2026)
```

Commit with the message `Pull HUD fair market rents into the property file`.

Change `2026` when HUD publishes a new year. It comes out each autumn for the fiscal
year starting that October.

### What to expect on the first full run

The build gets slower. FMR is cached per county rather than per property, so a county
with four hundred properties costs one HUD call, not four hundred. Across a national
file expect a few thousand calls and several minutes. If HUD starts throttling, raise
the delay: `apply_fmr(records, year=2026, delay=0.6)`.

Every property picks up `fmr_by_bedroom`, `fmr_area`, `fmr_year` and `fmr_basis`.
`fmr_basis` reads `zip` where the area publishes small area rents and the property's own
ZIP was used, and `area` otherwise.

---

## One thing to know about using FMR

Fair market rent is a gross figure. It assumes the tenant pays utilities. Comparing it
straight to a basic rent understates how close a property sits to market, by the whole
utility allowance. At Stevens Woods that gap is $96 on a one bedroom and $125 on a two
bedroom, which is the difference between reading 87% of FMR and reading 98%.

So the comparison is basic rent plus utility allowance, against FMR. The model book
already does it that way.

---

## The four smaller things, for whenever

These are worth doing and none of them are urgent.

1. **Natural Maturity is computed, not read.** It is eight days off the Stevens Woods
   note, which says 10/17/2041 against the file's 10/09/2041. Fine as an estimate.
   Worth labeling as one wherever it is displayed.
2. **Rate at Closing is the note rate.** At Stevens Woods it is 3.88% while the borrower
   pays 1.00% after interest credit. Both matter and the file carries one. A second
   field for the effective rate would close it.
3. **Date of Operation looks like the real age of the asset** and nothing downstream
   uses it. Stevens Woods reads 4/26/1982, which is the UCC filing date in its own
   closing binder. Oakridge reads 1/17/1985 against the 1984 we carry elsewhere.
4. **Add the FMR year to the site footer** once step 8 is running, so anyone reading a
   rent comparison can see which year it is against.

---

## If something goes wrong

Every change above is a commit, and a commit can be undone. Open the **Commits** list,
click the commit you want to reverse, then **Revert** at the top right. That makes a new
commit undoing it and leaves the history intact.

Nothing here deletes a field or drops a property.
