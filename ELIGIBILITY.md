# Medicaid Eligibility Verification (Phase 1, item 3)

Checks each client's NC Medicaid coverage automatically — when they're added,
on demand, and roughly monthly — and shows which plan they're under
(Standard Plan, Tailored Plan/LME-MCO, or NC Medicaid Direct), so you catch
coverage lapses **before** a session happens and a claim gets denied.

## What it does

- **Add a client** (name, DOB, Medicaid ID) → an eligibility check runs
  immediately and the result shows on the client list as a colored badge:
  `active` / `inactive` / `review` / `error`.
- **`review` status** means the payer answered but the answer wasn't clear —
  the raw response is shown for a staff member to read. The system never
  guesses "active."
- **Check now** button re-runs a check any time (e.g., day before intake).
- **Monthly re-checks**: a scheduled job hits `/tasks/recheck` daily; any
  active client not checked in the last 25 days gets re-checked. Clients
  marked inactive are skipped.
- **NC plan detection**: the response is scanned to identify the member's
  plan — Healthy Blue, WellCare, UnitedHealthcare, AmeriHealth Caritas,
  Carolina Complete Health (Standard Plans); Alliance, Trillium, Vaya,
  Partners (Tailored Plans); or NC Medicaid Direct — since that determines
  where you bill and request authorizations.

## Running it

```bash
pip install -r requirements.txt
python mh_app.py          # then open http://localhost:5001
```

With no configuration it runs in **mock mode** — no clearinghouse account
needed. Mock rules for testing: a Medicaid ID ending in `0` returns
`inactive`, ending in `9` returns `review`, anything else `active`.

Run the tests with `pytest`.

## Going live (real checks)

1. **Sign up with Claim.MD** (claim.md) — low-cost clearinghouse with an
   eligibility API — and complete their NC Medicaid enrollment step.
2. Set environment variables on your host:

   | Variable | Value |
   |---|---|
   | `CLEARINGHOUSE` | `claimmd` |
   | `CLAIMMD_ACCOUNT_KEY` | from your Claim.MD account |
   | `PROVIDER_NPI` | your billing NPI |
   | `NC_MEDICAID_PAYER_ID` | NC Medicaid payer ID **from Claim.MD's payer list** (default `NCMCD` — verify) |
   | `CRON_TOKEN` | any long random string, protects the re-check endpoint |
   | `DATABASE_URL` | Postgres URL in production |

3. Schedule the daily re-check (Render cron job or similar):

   ```bash
   curl -X POST "https://<your-host>/tasks/recheck?token=$CRON_TOKEN"
   ```

4. Verify the request field names against Claim.MD's current eligibility API
   docs before first use — the adapter is in `mh/clearinghouse.py`
   (`ClaimMDClearinghouse`) and is written to fail safe: anything it can't
   confidently classify lands in `review`, never `active`.

## Before storing real client data (PHI)

This module stores client names, DOBs, and Medicaid IDs — that is PHI.
Do **not** enter real clients until:

- Hosting is on a HIPAA-eligible platform **with a signed BAA**
  (the current Render free tier does not qualify).
- `DATABASE_URL` points at an encrypted Postgres database, not local SQLite.
- `STAFF_PASSWORD` is set, which turns on the staff login. Without it the
  app runs open (test mode - the header shows a warning). The Render
  blueprint prompts for this password at deploy time.
- You have a BAA with the clearinghouse (Claim.MD signs BAAs as part of
  onboarding).

The `.gitignore` already blocks local `*.db` files from being committed.
