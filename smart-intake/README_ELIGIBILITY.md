# Insurance eligibility checks (Availity) — the legal, fast NC Tracks alternative

Goal: from a client's **name + date of birth**, automatically check whether
they have active coverage (Medicaid or a commercial plan) during intake —
without logging into NC Tracks or any portal by hand, and without storing
government-portal passwords.

This uses the industry-standard **270/271 eligibility transaction** through
**Availity**. It is the same plumbing IntakeQ/SimplePractice use, it is
sanctioned by payers, and it cannot get a provider's NC Tracks account
suspended (unlike automated portal logins).

---

## Which Availity tier does what

| You want to... | Tier | Cost |
|---|---|---|
| Check coverage when you **know the plan** (e.g. "check Medicaid for this person"), using name + DOB (no member ID needed) | **Availity Essentials** | **Free** |
| **Discover** which insurance a person has from **name + DOB alone** — checks several payers at once, including Medicaid ("I don't know their plan, find it") | **Availity Essentials Pro / Coverage Discovery** | Paid add-on (quote) |

Start on the free tier. Add the Pro/Coverage Discovery tier later only if you
serve many walk-ins who don't know their plan.

---

## Your enrollment steps (about 20–30 minutes, one time per provider)

Do this once for each provider organization (each has its own NPI/Tax ID and
signs up separately — this keeps every agency's data walled off).

1. **Go to** https://www.availity.com and click **Get Started / Register** →
   choose **Provider / Provider Organization**.
2. **Enter the organization's details:** legal business name, **Tax ID (EIN)**,
   and **organization NPI** (Type 2). For a solo provider, the individual NPI
   (Type 1) is fine.
3. **Create the admin account** — the person who will manage users (that's you
   for setup; you can add the provider's staff later inside Availity).
4. **Verify the organization.** Availity confirms the NPI/Tax ID against payer
   records. This can be instant or take a day or two.
5. **Add payers / "enroll for transactions":** in Availity, add the plans the
   provider bills — for NC that's **NC Medicaid** plus the managed-care plans
   (Healthy Blue, AmeriHealth Caritas, Carolina Complete, WellCare, United
   Healthcare Community Plan, and the Tailored Plans: Alliance, Partners,
   Trillium, Vaya). Most are free to enable.
6. **Confirm you can run a manual eligibility check** in Availity Essentials
   (Patient Registration → Eligibility & Benefits). Try one real client:
   pick a payer, enter last name + first name + DOB (+ zip). You should get
   an active/inactive result back. This proves the account works.
7. **For the automated (API) hookup**, tell Availity you want **API access /
   the Availity Eligibility API** (sometimes under "Availity Developer" or via
   your account rep). They issue an **API client ID + client secret**. That is
   what the app uses — no password, no 2FA.

**Send me** (privately, into Render's Environment — never in chat):
`AVAILITY_CLIENT_ID` and `AVAILITY_CLIENT_SECRET`, plus which environment
(sandbox vs production). I wire the rest.

> Note: a BAA is required before real PHI flows through Availity. Availity
> signs one — request it during enrollment (it's standard for provider
> accounts). This is one of the vendor BAAs on the compliance checklist.

---

## What I build once the API key exists

1. **Auto-check on intake:** when a client's **name + DOB** are on file (from
   their own answers or the CCA), the app calls the eligibility API and stores
   the result on the intake — active/inactive, plan name, member ID, and
   effective dates. Staff see a green "Coverage verified: [plan]" badge, or an
   amber "No active coverage found — verify by hand" flag.
2. **"Check eligibility now" button** on the intake page for an on-demand
   re-check.
3. **Auto-fill:** the returned plan and member ID pre-fill `provider_choice_plan`,
   `mid_number`, and the MCO field — so the packet's insurance section fills
   itself from one lookup.
4. **(If you add Coverage Discovery):** a "Find their insurance" button that
   searches multiple payers from name + DOB when the client doesn't know their
   plan — ideal for walk-ins.

Everything is env-var gated exactly like DocuSign and the AI reader: with no
`AVAILITY_*` keys set, the feature is dormant and the manual NC Tracks
screenshot-upload (already built) remains the fallback.

---

## Why not automate the NC Tracks portal login directly

Automating the NC Tracks website login (username + password + emailed 2FA code
+ NPI) means building software that **defeats a government portal's security
control**. It violates NC Tracks' terms of use and can get a provider's account
**suspended**, freezing their Medicaid access. It also breaks every time the
site changes and requires storing many providers' portal passwords — a large
security and HIPAA liability. The 270/271 eligibility API above is the
supported, faster, safer way to get the same answer.
