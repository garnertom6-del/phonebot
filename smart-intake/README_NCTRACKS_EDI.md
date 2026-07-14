# NC Tracks direct eligibility (Trading Partner / EDI) — "NC Tracks only"

Goal: check a client's Medicaid coverage **straight from NC Tracks**, from a
**name + date of birth or Medicaid ID**, automatically during intake — using
NC Tracks' own machine-to-machine door, **not** by automating the website login.

This is the sanctioned way NC Tracks lets software ask "is this person
covered?": the **270/271 eligibility EDI transaction** over an enrolled
**Trading Partner** connection. No stored portal password. No 2FA to defeat.
No risk of the provider's NC Tracks account being suspended for automated logins.

---

## The two honest paths (both are "NC Tracks direct")

| Path | What it is | Best when |
|---|---|---|
| **A. Provider is their own Trading Partner** | The provider enrolls directly with NC Tracks EDI and gets submitter credentials; the app connects straight to NC Tracks | You want a pure NC Tracks-only connection and are willing to do the EDI enrollment |
| **B. Use NC Tracks through a Trading Partner/clearinghouse** | A clearinghouse is already an NC Tracks trading partner; you ride their connection (this is what the Availity guide covers) | You want the fastest setup and don't want to manage raw EDI |

Both hit the **same NC Tracks eligibility system**. Path A is "NC Tracks only,"
Path B is faster. This guide is **Path A**.

---

## Your enrollment steps — Path A (NC Tracks Trading Partner)

Do this once per provider organization (each has its own NPI). Budget a week or
two of back-and-forth with NC Tracks; the actual forms take under an hour.

1. **Start at the NC Tracks Trading Partner page:**
   https://www.nctracks.nc.gov/ → **Providers** → **Trading Partner
   Information** (also reachable via the NC Tracks EDI/Connectivity section).
2. **Sign the Trading Partner Agreement (TPA).** This is NC Tracks' contract
   that lets you submit/receive electronic transactions. It ties to the
   provider's **NPI** and organization.
3. **Register as an EDI submitter** and request the transactions you need —
   for eligibility that is **270 (inquiry) / 271 (response)**. (The same
   enrollment can enable 276/277 claim status and 837 claims later if wanted.)
4. **Get your submitter credentials + connectivity details** from NC Tracks:
   - a **Trading Partner / Submitter ID**
   - login/secret for the EDI channel (SFTP and/or web-service endpoint)
   - the **companion guide** (NC Tracks' spec for how the 270/271 must be
     formatted — I follow this exactly when I build it)
5. **Complete connectivity testing.** NC Tracks requires you to pass test
   transactions in their **testing region** before they turn on production.
   I build against the companion guide and we run their test cases together;
   NC Tracks then approves you for production.
6. **Go live.** NC Tracks flips your submitter to production and eligibility
   checks run for real.

**Send me** (privately — into Render's Environment, never in chat) once you
have them: the **Submitter/Trading Partner ID**, the EDI endpoint + secret,
and which region (test vs production). I wire the rest to the companion guide.

> BAA / data agreement: the Trading Partner Agreement itself is the data
> agreement with the state for this channel. Keep a copy for your compliance
> file.

---

## What I build once the submitter credentials exist

1. **Auto-check on intake:** when a client's **Medicaid ID** or **name + DOB**
   are on file, the app builds a compliant **270** inquiry, sends it to NC
   Tracks, parses the **271** response, and stores the result on the intake —
   active/inactive, plan (including which Tailored Plan / managed-care MCO),
   member ID, and effective dates.
2. **Green/amber badge on the intake page:** "Medicaid active — [plan]" or
   "No active NC Medicaid found — verify by hand," plus a **"Check NC Tracks
   now"** button for an on-demand re-check.
3. **Auto-fill:** the 271 result pre-fills `has_medicaid`, `mid_number`,
   `mco`, and `provider_choice_plan` — so the packet's Medicaid/plan section
   fills itself from one lookup.
4. **Audit + isolation:** every lookup is written to the audit log under the
   provider, and one provider's NC Tracks connection is never visible to
   another (same walls as the rest of the app).

Everything is env-var gated: with no `NCTRACKS_EDI_*` credentials set, the
feature is dormant and the existing **NC Tracks screenshot-upload reader**
(staff snap the eligibility screen, the AI fills the fields) remains the
fallback — that already works today with zero enrollment.

---

## What is deliberately NOT built, and why

Automating the NC Tracks **website login** (typing username + password, pulling
the emailed **2FA code** from email, entering it, then scraping pages) is not
built. That defeats a government portal's security control, violates NC Tracks'
acceptable-use terms, can get the provider's account **suspended** (freezing
Medicaid access), breaks whenever the site changes, and forces storing many
providers' portal passwords — a serious security and HIPAA liability. The
Trading Partner EDI channel above is NC Tracks' own supported path for
software and gets the same answer faster and safely.
