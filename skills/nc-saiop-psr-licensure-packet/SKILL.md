---
name: nc-saiop-psr-licensure-packet
description: "Generate a complete North Carolina DHSR / Medicaid behavioral-health licensure packet for a provider agency from a single provider record — the Policy & Procedure Manual (PDF + editable DOCX), the filled DHSR Policy & Procedure Worksheet(s), the ASAM 27G .4400 waiver, the facility walk-through form, the multi-service staff-coverage worksheet, the required-materials checklist, and the blanks-to-complete report. Use when the user wants to create, build, mass-produce, duplicate, or \"get a client ready\" for NC SAIOP (Substance Abuse Intensive Outpatient, 10A NCAC 27G .4400 / Clinical Coverage Policy 8A-12) and/or PSR (Psychosocial Rehabilitation, 10A NCAC 27G .1200), mentions an NC DHSR mental health license, a policy and procedure manual or worksheet, onboarding a new provider for licensure, or NCDHHS / Medicaid behavioral-health licensure. Produces a print-ready packet with agency-specific blanks left for the owner to complete and sign."
---

# NC SAIOP / PSR Licensure Packet

One engine. Many providers. **The only thing that changes per provider is one JSON file.**

## THE MODEL — read this before anything else

```
_engine/          the template. Contains {{TOKENS}}, belongs to NO provider. NEVER edit per provider.
providers/<slug>/provider.json    the ONE file that changes. ~30 fields.
providers/<slug>/output/          the finished packet.
_build/<slug>/                    throw-away working copy. Safe to delete anytime.
TRACKER.csv                       one row per provider, sorted by DHSR deadline.
```

**Do not copy the engine folder for a new provider.** The old workflow (fork the
folder, run `reconfigure.py`, which string-replaced the agency name inside the
scripts) is gone and must not be reintroduced. It permanently consumed a folder
per provider, silently corrupted any word that happened to contain the old city
name, and could never be re-pointed twice.

## HOW TO RUN IT

### If the user pastes a provider record (from the intake form)

1. Read the JSON. Pick or confirm the `slug`.
2. Write it to `providers/<slug>/provider.json`.
3. Run `python3 _engine/build_provider.py <slug>`.
4. Deliver everything in `providers/<slug>/output/`, and lead with
   `BLANKS_TO_COMPLETE.md`.

### If the user just names a provider

Ask the intake in **ONE round** (below), then the same three steps.
Or hand them the intake form so the provider fills it themselves.

### The intake — ask everything at once

Structural answers change what gets built, so a missed one costs a full rebuild.

- Legal name, DBA, for-profit/nonprofit, physical address, city, **county**, mailing address
- Contact name, email, phone
- **Tailored Plan / LME-MCO** — verify by lookup. Never infer from county from memory.
- **Services**: SAIOP, PSR, or both
- **Population**: adults / adolescents / both — *structural*
- **Uses restrictive interventions?** — *structural*; drives worksheet pages 16–22
- **Administers medication?** — *structural*; drives items 16–23
- **Pool? Facility animals? Mobile unit?** — *structural*; items 91, 92, 93
- **Site type**: day program / residential / both — *structural*; drives the walk-through
- Hours of operation, per service
- **Date of first meeting with the DHSR Licensure & Certification consultant** — starts a
  **6-month deadline** (Standard List of Materials, p.2). The builder alerts at 90/30/14 days.
- Governing body signatory, clinical director, QP of record —
  **leave blank if not supplied. Never invent.**

## THE CAPABILITY GATE — never bypass it

`resolve.py` refuses to build when a provider's structural profile does not match
the policy content the engine actually carries. Currently supported:

| Field | Supported |
|---|---|
| `population` | `adults`, `adolescents`, `both` |
| `uses_restrictive_interventions` | `false`, `true` |
| `ri_types` | `physical_restraint`, `protective_devices`, `seclusion`, `isolation_time_out` |
| `site_type` | `day_program` only |
| `administers_medication` | `false` only |
| `has_pool` / `has_facility_animals` / `has_mobile_unit` | `false` only |

`seclusion` and `isolation_time_out` additionally require
`has_conforming_seclusion_room: true` — a room meeting EVERY requirement of
10A NCAC 27E .0104(e)(8), including a lock **interlocked with the fire alarm**.
A normal outpatient office does not meet this. If the room does not exist, leave
those out of `ri_types`; the governing body then prohibits them under
27D .0101(c)(1), which is accurate and defensible.

This is not fussiness. The manual makes **flat factual claims** about the agency —
what it does and does not do, which worksheet pages are left unfilled, which
committees exist. Build a provider against content that contradicts its real
profile and you have not made a formatting error. You have filed a State document
that says something untrue about the agency, at whatever scale you are duplicating.

**Scope confirmed with the consultant (August 2026): no provider on this roster
offers medication administration, a pool, facility animals, or a mobile unit.**
Every provider they run therefore builds. The four checks REMAIN in the gate and
the four questions REMAIN on the intake form, and must not be removed or
hardcoded, for one reason:

> The manual states in print that the agency does not prescribe, dispense,
> administer, transport, dispose of or store medication, operates no pool, keeps
> no facility animals, and runs no mobile unit. Those sentences are true only
> because the record says `false`. Hardcode the answer and you delete the check
> that makes the claim honest — and a provider that adds medication
> administration in a later year gets a manual that lies about it.

"We don't do that" is a fact about today, not a permanent property of an agency.
The gate is what catches the day it changes. Should a provider ever answer `true`,
the gate fires and the missing policy content must be written first — exactly as
it was for adolescents and restrictive interventions.

Residential / 24-hour (`site_type`) is likewise unsupported and unneeded on this
roster.

When the gate fires: report exactly what it said, and offer to write the missing
policy content. Then add it to `_engine/` and extend `SUPPORTED` in `resolve.py`.
**Never edit the provider record to make the gate pass.**

## CONDITIONAL CONTENT PACKS

Two packs load off the provider record. They OVERRIDE base policies by number,
so there is never a base and a pack version of the same policy in one manual.

- **`policies_ri.json`** (44 policies) loads when `uses_restrictive_interventions`
  is true. Full 10A NCAC 27E .0100 series: least restrictive alternative,
  prohibited procedures, permitted-intervention identification, the 15-minute rule,
  age-based order limits, 15-minute observation, dedicated 1:1 for isolation
  time-out, CPR-trained monitoring during manual restraint and 30 minutes after,
  documentation with two signatures, notification, debriefing, the log, quarterly
  data analysis, planned interventions, the Intervention Advisory Committee,
  protective devices, and the two-tier .0107/.0108 training structure.
  `worksheet_desc_ri.json` replaces the "N/A – no restrictive interventions"
  worksheet comments at the same time.
- **`policies_adolescent.json`** (12 policies) loads when `population` includes
  adolescents. Removes the 5-O placeholder outright and adds Section 8: population
  and scope, adolescent staff training, minor consent, 42 CFR 2.14 confidentiality,
  legally responsible person, school coordination, abuse reporting, group
  composition, and adolescent crisis response.

### THE CONTRADICTION GUARD — the reason conditional content is safe

Conditional content fails one way: a sentence survives the switch and now says
the opposite of the truth. A signed manual asserting "the Agency does NOT use
restrictive interventions" for a provider that does is worse than no manual.

So the build sweeps **twice**:

1. `resolve.py` sweeps the rendered SOURCE and exits 3 on any hit.
2. `build_provider.py` sweeps the **delivered PDF text** — what actually reached
   the page, the only version anyone signs — and marks the packet `CONTRADICTION`.

If either fires, **fix the content pack, never the provider record.**

## THREE THINGS THE RESEARCH CORRECTED — verified August 2026

**1. Adolescent hours: the licensure floor is higher than the billing floor.**
10A NCAC 27G .4403(b) and (d) require **3 hrs/day and a minimum of 9 hrs/week for
every client, with no adolescent exception.** The familiar "2 hrs/day, 6–19
hrs/week" adolescent figures are **Clinical Coverage Policy 8A-12** — Medicaid
*coverage*. DHSR surveys against the rule. An adolescent at 6 hrs/week is billable
and licensure-noncompliant. Earlier versions of this skill stated the coverage
figure as though it were the rule; it is not.
Related unresolved conflict: CCP 8A-12 Attachment A defines H0015 as one event per
day "minimum of 3 hours" with no adolescent footnote, which does not reconcile with
the 2-hour adolescent service day in §6.3. Get written payer clarification.

**2. No rule prohibits seclusion in an outpatient setting.**
There is no categorical ban in 27D or 27E. What actually gates it is (a) the
governing body naming it prohibited under 27D .0101(c)(1) and 27E .0102(2), and
(b) the room specs in 27E .0104(e)(8). Never write "the State prohibits it" —
write "the governing body prohibits it and no conforming room exists," which is
both true and stronger.

**3. There is no training-hour minimum in 27E.**
Neither .0107 nor .0108 states any number of hours. The standard is demonstrated
competence against Division-approved content. Any "4.0 hours" figure comes from a
curriculum vendor or an LME-MCO contract — cite it as such, never as a rule.

Also flagged: the claim that CCP 8A-12 issues **under the NC 1115 SUD Demonstration
Waiver** could not be verified from a primary source. Do not assert it.
Two codification artifacts exist in the official text and are not transcription
errors: 27E .0104(g)(5) cross-references a nonexistent paragraph "(h)", and
27E .0108 skips paragraph "(j)" while (i)(5) references "(j)(6)".

## THE FOUR BUNDLES

A packet is not shippable unless all four are present. **The builder produces all
four** — bundle 3 comes from `build_training.py` and `build_certificates.py`,
bundle 4 from `build_disaster.py` and `build_oem.py`, and step 8 collects both
into the output folder. What a finished build still owes is not a bundle but the
agency-specific blanks: lead with `BLANKS_TO_COMPLETE.md`, and never call a packet
complete while its blanks are open.

1. **Policy & Procedure Manual** — PDF + editable DOCX. One policy per page
   `P-01…P-53` (blocks: Authority/Source Alignment → Responsible Position(s) →
   Purpose → Policy → Procedure), then appendices `A-01…A-10`, then the Governing
   Body Approval page and Staff Attestation, then the Revision Addendum. ✅ built
2. **DHSR forms** — Policy & Procedure Worksheet (one per service category),
   Walk-Through, Standard List of Materials, Multi-Service Schedule, ASAM
   27G .4400 Waiver. ✅ built
3. **Training curriculum** — ✅ built by `build_training.py` from
   `training_catalog.json`, filtered by the provider profile. Produces a training
   matrix, a master binder, and one booklet per training. `build_certificates.py`
   then emits a print-ready Certificate of Completion per training into
   `07_Training/Certificates/`. See below.
4. **Disaster / emergency plan** — ✅ built by `build_disaster.py` and
   `build_oem.py` into `08_Disaster_Plan/`. Eight documents: disaster plan, fire
   plan, OEM request letter, OEM verification form, evacuation posting, drill log,
   quick reference, records continuity. See below.

## THE CERTIFICATE PACK

`build_certificates.py` reads the same three inputs as `build_training.py` —
`agency_config.json`, `profile.json`, `training_catalog.json` — and shares its
`applies()` rule verbatim, so the certificates and the booklets can never cover
different trainings. It emits into `07_Training/Certificates/`:

- `NN_<id>.pdf` — one landscape certificate per applicable training
- `00_ALL_CERTIFICATES.pdf` — every certificate in one print job
- `Express_HTML/NN_<id>.html` — the same design as self-contained HTML

**ReportLab draws the PDF directly.** No LibreOffice pass, no browser, no network
and no Adobe Fonts, so certificates cannot be silently dropped by a missing
Writer filter the way a DOCX→PDF conversion can, and the output is identical on
Windows and Linux. Fonts resolve from a candidate list (Liberation → DejaVu →
Georgia/Times) and fall back to ReportLab built-ins of the same metric class.

**The HTML twin is the restyling path.** It carries the Adobe Fonts embed
(Essonnes Headline + Acumin Pro) that the PDF cannot use locally. Push any one of
those files to Adobe Express when the template needs redesigning; the PDF stays
the bulk production path.

**The agency is the headline name; the preparer is a footer line.** The
certificate lives in that agency's personnel file and a surveyor reads it as that
agency's training record, so `legal_name` is the large name. Override the preparer
with the `CERT_PREPARER` environment variable; it defaults to Successful
Solutions.

**Nothing on it implies state issuance.** The rosette is an ornament with no
lettering, and no NCDHHS or DHSR mark appears anywhere. A certificate that looked
state-issued would fail the same test the nine external trainings fail — material
that looks official without satisfying the rule is worse than none.

The four fields — date completed, score/result, instructor, next refresher due —
carry over from the in-booklet certificate and are what the record is actually
for. The rule citation prints under the title, straight from the catalogue.

## THE TRAINING PACK

`training_catalog.json` holds **29 trainings**; `build_training.py` selects the ones
that apply to the provider (SAIOP / PSR / adolescent / RI) and emits
`07_Training/` with a matrix, a master binder, and per-training booklets.

**The split that matters — 20 authored, 9 external.**

An AUTHORED booklet carries cover, instructor guide with a timed agenda,
participant handout, sign-in sheet, multiple-choice post-test, answer key and
certificates.

An EXTERNAL booklet carries cover with a legal notice, curriculum verification
page, sign-in sheet, testing-record page and certificates — and **deliberately no
instructor content**. Nine trainings cannot be authored in-house:

- `27E .0107` de-escalation and `27E .0108` restrictive interventions — paragraph
  (f) of each requires content **approved by the NC Division of MH/DD/SUS**.
- CPR / First Aid — `27G .0202(h)` requires a recognised certifying body.
- Six CCP 8A-12 trainings marked with an **asterisk** in the policy's own table:
  Crisis Response, Trauma-Informed Care, Co-Occurring Conditions, Introductory
  Motivational Interviewing, designated modalities, and the annual EBP/cultural
  competency CE. The footnote requires review and approval by an NC DHHS-recognised
  accreditation entity or a nationally recognised programme (NCASPPB, NAADAC, NBCC,
  NASW, APA, MINT).

**Never author content for an external training.** Material that looks official and
does not satisfy the rule is worse than no material — staff would be recorded as
trained on content that does not count.

For the two 27E trainings, note also that `.0107(d)` and `.0108(d)` require
measurable testing **in writing AND by observation of behaviour**. A multiple-choice
test alone does not satisfy them; the booklet says so and provides an observation
result field.

### PSR carries almost no training of its own

`10A NCAC 27G .1202` names **zero** training topics — it requires only a designated
program director and **1 staff : 8 clients in average daily attendance** (a STAFF
ratio, not a QP ratio). PSR's training list therefore comes entirely from the generic
`27G .0202(g)` personnel rule. PSR stayed inside **CCP 8A** when the SUD services were
pulled out on 1 Jan 2026, so there is no PSR analogue of the 8A-12 training table.
NC-TOPPS is **not** required for PSR. A PSR-only provider gets 13 trainings; a
SAIOP+PSR provider serving both ages and using RI gets 29.

### Two more corrections

- **Quarterly fire and disaster drills apply to 24-HOUR facilities only**
  (`27G .0207(c)`). A periodic outpatient SAIOP or a five-hour-a-day PSR is not one.
  The other `.0207` duties — written plans, availability to staff, posted routes,
  first aid kit — do apply.
- **There is still no training-hour minimum anywhere.** Not in .1200, .4400, .0200,
  .0600, 27E, or the coverage policies. The agenda minutes in each booklet are
  labelled as a house planning convention, and the matrix says so in print.

**Open verification item carried in the binder:** the PSR entry in **CCP 8A
Attachment D** could not be retrieved from a primary source and is the one place a
PSR-specific training table could exist. It is printed as an open item rather than
asserted either way.

## THE DISASTER BUNDLE

`build_disaster.py` (+ `build_oem.py`) emits `08_Disaster_Plan/` — eight
documents, county and services resolved from the provider record.

### The .0207 trap — the reason this bundle is written the way it is

**10A NCAC 27G .0207 was readopted effective 1 November 2022 and the operative
verb changed.**

| | text |
|---|---|
| before | the plan "shall be developed and **approved by the appropriate local authority**" |
| now | the facility "shall make a copy of these plans **available to the county emergency services agencies upon request**" |

**DHSR's own Policy & Procedure Worksheet (REV 03-20-25) still paraphrases the
REPEALED language.** Their review instrument lags their rule by four years.

Write only to the current rule and a surveyor working from the Workbook can cite
you. Write only to the Workbook and you are quoting repealed language. The plan
therefore satisfies **both** — available on request AND transmitted to the county
with written verification obtained — and says so in a boxed notice on page 1.
**Do not "simplify" this by picking one.**

### The OEM verification is a discrete checklist line

The DHSR *List of Required Materials* (the blank in `_engine/assets/`, Revision
Date 04-27-26) lists under **Disaster Plan** exactly two items:

- Written Disaster Plan
- **Verification from Local Emergency Management (OEM)**

There is **no DHSR form** for it and **no DHSR template** for the plan — their FAQ
says "There is no standard template" outright. So the verification form here is
purpose-built, and it offers **three postures** because county practice genuinely
varies: some counties formally review and approve through the **NC Risk Management
Portal** (`rmp.nc.gov`, NCID required) and treat the filed plan as a condition of
the licence issuing; some review and comment but expressly do **not** approve; some
only acknowledge receipt. A form demanding "approved" is unsignable in two of the
three, and chasing an approval a county will never give is how a packet misses the
six-month deadline.

### What the plan is structured on

DHSR publishes no template but its FAQ does give four content domains, and the
plan uses them as its skeleton: preparedness/training/practice (shelter-in-place,
lockdown, shelter-out), communication with backups, special needs, and recovery.
Hazards come from the *State of North Carolina Hazard Mitigation Plan* (Dec 2022).
Extended power loss is written as a **cascading consequence** of the winter-weather
and hurricane profiles, not invented as a standalone state hazard.

### Four more things the research settled

- **The CMS Emergency Preparedness Rule does NOT apply.** It covers 17 certified
  provider types; freestanding outpatient behavioral health under a State licence
  is not among them. Do not build against it.
- **A long closure is a licence risk.** `27G .0404`: a licence for a facility that
  has **not served any clients in the previous 12 months shall not be renewed**, and
  planned closure needs 30 days' advance written notice to DHSR, clients and LRPs.
  That is in the recovery section, not buried.
- **42 CFR 2.51(a)(2)** is the disaster disclosure provision, and **both** conditions
  must hold: the programme closed and unable to serve, AND a declared state or
  federal emergency. The four-element disclosure log required by 2.51(c) is a form
  in the bundle.
- **Quarterly per-shift drills are 24-hour only** (`.0207(c)`). Stated in both the
  disaster plan and the fire plan so nobody adds a requirement that does not apply.

`.0207(a)` requires a fire plan **and** a disaster plan — two documents — so both
exist separately rather than as one file with a fire section.

## RUN ORDER — NOT NEGOTIABLE

`build_provider.py` enforces this. Do not run the steps by hand out of order.

```
validate record + capability gate + render
   → manual pass 1
      → page index built from the DELIVERED PDF
         → manual pass 2 (real page numbers in the TOC)
            → fill_worksheet4.py   ← page numbers come from that index, never memory
               → walk-through, materials, multi-service, ASAM waiver
                  → BLANKS_TO_COMPLETE.md
                     → cross-contamination sweep
                        → TRACKER.csv
```

If the manual is edited, everything downstream rebuilds. Hand-editing page numbers
into a worksheet is how packets get returned.

## THE WORKSHEET IS THE SPINE

**95 rows**: items 1–93, plus **35a**, plus **84 twice** (once under NCGS 122C-63
Continuity of Care, once under NCGS 122C-61 Treatment Rights). A loop over
`range(1,94)` misaligns everything after 35 — drive it from `rulepack/items.json`.

Every row needs three things: a **manual page number**, a **Yes** mark, and a **comment**.

**There is no N/A checkbox on the official form.** House convention: for an
operationally non-applicable item, mark **Yes** — because the manual genuinely
carries a policy addressing it — and explain the N/A in the comment. **A Yes whose
page number does not resolve to a real manual page is fabrication, not a formatting miss.**

**No "No" box is ever checked.** If an item cannot be answered Yes with a real policy
behind it, stop and escalate to the user with the item number.

Comment format is locked:

```
{item#}. {one-sentence policy summary} — {rule citation}; p.{manual page}
```

e.g. `12. Requires a written individualized supervision plan for each paraprofessional, developed upon hire — 10A NCAC 27G .0204; p.20`

Rule → item map: 27G .0201→1–9 · .0202→10–11 · .0204→12 · .0205→13–14 · .0207→15 ·
medication→16–23 · 27D .0103→24–26 · .0104→27 · .0201→28 · .0202→29 · .0301→30 ·
.0302→31 · .0303→32 · .0304→33 · 27E .0101→34 · .0102→35 · 27D .0101→35a–46 ·
27E .0103→47 · .0104→48–62 · .0105→63–64 · .0106→65–68 · .0107→69–73 · .0108→74–79 ·
27D .0102→80–82 · §131E-256→83 · 122C-63→84 · 122C-61→84 · 122C-62→85–86 ·
27F .0102–.0105→87–90 · pools→91 · animals→92 · 27G .3605→93.

Worksheet pages 16–22 are the highlighted restrictive-intervention block — filled
**only** when the provider uses RI.

## KNOW WHICH LAYER CHANGED — verified August 2026

This is the single most common way this domain gets stated wrong.

- **10A NCAC 27G .4401 / .4402 / .4403 (SAIOP) were NOT rewritten in 2026.** They still
  carry *"Eff. April 1, 2006; pursuant to G.S. 150B-21.3A, rule is necessary without
  substantive public interest Eff. July 20, 2019."* Confirmed on OAH; neighbouring rules
  show 2022–2024 amendments, so the absence of a 2026 amendment is meaningful, not stale posting.
- **What changed effective January 1, 2026 is payer policy.** SAIOP was pulled out of
  Clinical Coverage Policy 8A and issued as **stand-alone CCP 8A-12**, aligned to
  **ASAM Level 2.1**, under the NC 1115 SUD Demonstration Waiver. The parallel
  **state-funded SAIOP service definition** was newly issued the same date.

Rules and payer policy are versioned **separately** for exactly this reason. Never merge them.

## FORM LANDMINES — every one of these was found in the real files

- **Check the revision hash before filling anything.** A revised form fills "correctly"
  and gets rejected on sight. This already happened: the Walk-Through was revised to
  **4-6-26** and **three acknowledgment checkbox fields were deleted** (170 → 167).
  Code written against the old revision silently no-opped.
- **Field names lie. Place by widget rectangle.** On the Workbook, names do not encode
  item numbers. On the Multi-Service Schedule, suffixes do not map to day columns
  (verified: block 1 row 3 runs Mon=`3`, Tue=`3_3`, Wed=`3_4`, Thu=`3_2`).
- **Read checkbox on-states, don't assume.** Workbook = `/Yes` (column `.0` Yes, `.1` No).
  Materials = `/On`.
- **Three fields that don't exist — overlay required:**
  - Walk-Through 4-6-26: licensee signature, date, and all four bottom acknowledgment
    checkboxes are flat.
  - Walk-Through hot-water table: no field for the temperature value itself.
  - Standard List of Materials: the "Health Care Personnel Registry Verification" row
    has no field.
- **Shared-field trap:** on the Materials list, Med Admin Training / CPR / First Aid are
  three printed rows sharing **one** field. Setting it checks all three. Write `/AS` per
  kid widget to check them independently.
- Set `/NeedAppearances true` if leaving fields live, or filled text renders blank in
  some viewers.

## GUARDRAILS

- **Never fabricate** staff names, credentials, license numbers, phone numbers, the
  24/7 crisis number, MHL#, signatures, or attachments (bylaws, org chart). These stay
  labeled blanks. `BLANKS_TO_COMPLETE.md` is generated from the delivered PDF and lists
  every blank, its page, and who signs it — that file is **a deliverable, not a debug log**.
- **Population and services are structural, not string substitution.** The gate and
  the contradiction guard enforce this together.
- **42 CFR 2.14(a) is the highest-risk provision in an adolescent SAIOP.** NC lets a
  minor consent alone to SUD treatment (G.S. 90-21.5(a)(iii)), which makes NC a
  2.14(a) state: for a self-consenting minor the MINOR alone holds the disclosure
  key — including disclosure to a parent for the purpose of obtaining financial
  reimbursement. Billing a parent's plan without the minor's written consent is a
  Part 2 violation. Build the check into the billing workflow, not just the manual.
- **G.S. 90-21.5(a) grants consent "to a physician."** Whether that extends to a
  SAIOP delivered by LCAS/LCSW/LCMHC staff is unsettled on the face of the statute.
  Policy A-3 flags it for NC counsel; do not resolve it silently.
- **The ASAM waiver commits the agency operationally** — ≥5 days/week, ≤2 consecutive
  days without service, ≤19 hrs/week, ≥9 hrs adults / ≥6 hrs adolescents, group every
  service day, 24/7 crisis, and waiver addition (h): **a Licensed Professional onsite
  whenever SAIOP operates.** The manual and the Multi-Service Schedule must actually
  support this. A schedule that doesn't staff a Licensed Professional across all SAIOP
  hours contradicts the signed waiver.
- **Verify currency before every submission.** Re-check the live rules
  (`reports.oah.state.nc.us`: 27G .4400, .1200; 27D; 27E; 27F) and the current Clinical
  Coverage Policies. Quarterly at minimum.
- **The contamination sweep runs automatically** and greps the finished packet for every
  *other* provider's legal name, address, city, county, email, plan and MHL number. If it
  reports hits, the packet status is `CONTAMINATED` — do not deliver it. The usual cause
  is a stale `_build/<slug>/`; delete it and rebuild.
- **This is a strong draft, not legal advice and not a guarantee of approval.** Clinical
  leadership and an NC licensure consultant should review the final packet.

## WHEN DHSR RETURNS A PACKET

Capture the deficiency list **verbatim** into `providers/<slug>/deficiencies/`. Then
decide: is this a **data fix** (this provider only → edit `provider.json`) or an
**engine fix** (every future provider → edit `_engine/`)?

**Most returns are engine fixes and get wrongly treated as one-offs.** That is the whole
point of having one engine: fix it once at the engine level, rebuild every affected
provider, re-QA, resubmit, and record what changed. Under the old fork-per-provider
model this was impossible, which is why the same deficiency kept coming back.

## HAND OFF TO THE TESTER

Never deliver a packet the `agent-tester` licensure gate has not passed. It checks
form-revision currency, all 95 rows answered, every page number resolving to the right
policy, no No boxes, no fabricated credentials, the four bundles present, and the
flat-field spots that only visual inspection catches.
