---
name: carf-peer-support-accreditation
description: "Build a complete CARF accreditation packet for a peer-support-delivered behavioral health provider — the Policy and Procedure Manual (58 policies organized by CARF standard area), the 12 annual written plans, the 72-form packet, the 12-month readiness roadmap, the training matrix, the mock survey interview guide, the evidence binder index, the self-study conformance checklist, and the blanks-to-complete report, as editable DOCX plus print-ready PDF plus XLSX. Use when the user wants to get a provider CARF accredited, mentions CARF, the Behavioral Health Standards Manual, ASPIRE to Excellence, a CARF survey or resurvey, a Community Integration program, peer support specialist accreditation, a CARF self-study, an accreditation readiness assessment, a mock survey, or a CARF Quality Improvement Plan. One engine, many providers: the only thing that changes per provider is one JSON file."
---

# CARF Accreditation Packet — Peer-Delivered Community Programs

Built for **Successful Solutions** to take a provider from nothing to survey-ready.

## READ THESE THREE THINGS BEFORE YOU DO ANYTHING

### 1. THE COPYRIGHT LINE — never cross it

CARF's standards are **copyrighted and sold by CARF**. This skill contains **no CARF standard
text**. Everything in `_engine/content/` was written from scratch for this skill.

What that means in practice:

- **Never quote, paraphrase closely, or reproduce standard text from the manual**, in a
  document, in chat, or in a file. Not even "just this one standard."
- **Never present a standard number as verified** unless a human has confirmed it against the
  purchased manual.
- If a user pastes manual text at you, use it to *check* the section map. Do not copy it into a
  generated document and do not redistribute it.
- The right answer to "just tell me what standard 1.K.3 says" is: *"I can't reproduce the
  manual — it's CARF's copyrighted text and it has to be purchased. Here is what that area
  covers and the evidence you'll be asked for."*

Tell the user plainly, at the start of every engagement: **they must buy the current Behavioral
Health Standards Manual from carf.org.** There is no way to do this properly without it, and
this skill is not a substitute for it.

### 2. THE VERIFICATION GATE

`_engine/content/meta/standards_map.json` carries the area letters and names (1.A Leadership
through 3 program standards). That outline has been stable for years, but **no one here has read
the user's edition**, and CARF revises annually (each manual runs July 1 – June 30).

So the builder refuses to claim verification it does not have:

- `manual_verified: false` (the default) → every document is stamped **DRAFT — section map
  unverified**, and section 0 of `BLANKS_TO_COMPLETE.md` explains exactly how to verify.
- Only a human, with the purchased manual open, sets it to `true`.

**Never set `manual_verified: true` on the user's behalf.** Never say "verified against the 2026
manual" unless the user tells you they did it.

### 3. THE PEER SUPPORT NAMING TRAP

**CARF does not accredit "peer support."** There is no peer support accreditation to apply for.
CARF accredits **programs**. In the Behavioral Health manual those include Community Integration,
Case Management/Services Coordination, Assertive Community Treatment, Crisis Intervention,
Supported Living, Health Home, CCBHC, and others.

Peer support is the **workforce and the service model** that delivers a program.

So a provider "getting accredited in peer support" is really applying for a program — most often
**Community Integration** — that its certified peer support specialists deliver. The
peer-specific requirements are enforced across:

| Where | What it enforces |
|---|---|
| 1.I Human Resources | lived experience as a qualification, credential verification, competency (not just training), supervision |
| 2.A Program/Service Structure | the written program description and the staffing plan |
| 2.C Person-Centered Plan | goals in the person's own words, planning *with* the person |
| Section 3 program standards | Community Integration, or whichever program is on the application |

This skill adds a **3.PEER cross-cutting area** — self-disclosure, boundaries and dual
relationships, peer workforce wellness, credential and scope, the career ladder — so nothing
peer-specific falls between those cracks. 3.PEER is *this skill's organizing device*, not a CARF
section number. Say so when you present it.

**Correct this misconception early and gently, every time.** Getting the program name wrong on
the survey application costs a provider months.

---

## THE MODEL

```
_engine/          the template. Contains {{TOKENS}}, belongs to NO provider. NEVER edit per provider.
  content/policies/   58 policies, one .md file each, organized by CARF area
  content/plans/      12 annual written plans
  content/forms/      72 forms and tools
  content/meta/       standards_map.json, roadmap, training matrix, mock survey guide
  resolve.py          tokens, the capability gate, the blanks ledger
  docx_kit.py         Markdown -> DOCX
  pdf_kit.py          Markdown -> PDF (native; no LibreOffice or Word needed anywhere)
  build_provider.py   the builder

providers/<slug>/provider.json    the ONE file that changes. ~35 fields.
providers/<slug>/output/          the finished packet.
TRACKER.csv                       one row per provider, sorted by target survey month.
```

**Do not copy `_engine/` for a new provider.** Do not hand-edit the generated Word files and then
rebuild — the rebuild overwrites them. Fix `provider.json` and rebuild.

## HOW TO RUN IT

### If the user gives you a provider record

1. Write it to `providers/<slug>/provider.json` (schema: `_engine/provider.schema.json`).
2. `python3 _engine/build_provider.py <slug>`
3. Deliver everything in `providers/<slug>/output/`, and **lead with `00_START_HERE.md`, then
   `BLANKS_TO_COMPLETE.md`.**

### If the user just names a provider

Ask the intake in **ONE round**. Structural answers change what gets built, so a missed one costs
a rebuild. Or hand them `PROVIDER_INTAKE_FORM.html` to fill in themselves.

- Legal name, DBA, for-profit/nonprofit, address, **counties served**, phone
- **Which CARF program(s)** — see the naming trap above; do not accept "peer support" as the answer
- **Population**: adults / adolescents / both — *structural, gated*
- **Settings**: office / community / home / telehealth / residential — *structural, gated*
- **Manual year** and whether they have bought it
- Initial accreditation or resurvey; **target survey month**
- Which EHR; which payers; the **state peer credential** by its exact name
- **Do they administer medication?** — *structural, gated*
- **Do they use any restrictive intervention?** — *structural, gated*
- **Do they hold SUD records under 42 CFR Part 2?** — adds Part 2 content
- Do they transport people? Use telehealth? Operate vehicles?
- Named people: CEO, Program Director, Supervisor, QI Coordinator, Safety Officer, Privacy
  Officer, Compliance Officer, governing body — **leave blank if not supplied. Never invent.**

Anything not supplied prints as `[FILL IN: <role>]` and lands in `BLANKS_TO_COMPLETE.md`.

## THE CAPABILITY GATE — never bypass it

`resolve.py` refuses to build when the provider's real profile contradicts the content this
engine carries.

| Field | Supported today |
|---|---|
| `programs` | `community_integration` |
| `population` | `adults`, `older_adults` |
| `settings` | `office`, `community`, `home`, `telehealth` |
| `administers_medication` | `false` only |
| `uses_restrictive_interventions` | `false` only |

This is not fussiness. The generated manual makes **flat factual claims about the agency** — that
it does not administer medication, that it prohibits restraint without exception, that it does or
does not transport people. Those sentences are true only because the record says so. Build a
provider against content that contradicts its real profile and you have not made a formatting
error; you have produced a document that says something untrue about the agency, and the agency
will sign it.

When the gate fires: **report exactly what it said, and offer to write the missing content.** Add
it to `_engine/content/`, wire it into `standards_map.json`, then extend `SUPPORTED` in
`resolve.py`. **Never edit the provider record to make the gate pass.**

## WHAT GETS BUILT

| File | What it is |
|---|---|
| `00_START_HERE.md` | The beginner's walkthrough. Deliver this first. |
| `BLANKS_TO_COMPLETE.md` | The verification gate, missing fields, defaulted decisions, bracketed blanks |
| `01_Policy_and_Procedure_Manual` | 58 policies by CARF area, each with owner, review cycle, and **the evidence a surveyor will ask for** |
| `02_Annual_Plans` | Strategic, Risk, Health & Safety, Business Continuity, Technology, Accessibility, Cultural Competency, Compliance, Financial, Workforce, Performance Measurement, Performance Improvement |
| `03_Forms_Packet` | 72 forms — consents, rights, grievance, person-centered plan, progress note, crisis plan, discharge, competency, supervision, record review, incident, drill, and the peer-specific ones |
| `04_Roadmap_and_Survey_Prep` | 12-month countdown with owners, training matrix, mock survey interview guide, evidence binder index |
| `05_Self_Study_Checklist.xlsx` | Every required document with owner, status, gap, and due date; second sheet is interview prep |

DOCX and PDF for 01–04. PDFs are generated natively by ReportLab — the packet never depends on
LibreOffice or Word being installed.

## THE TIMEFRAMES ARE THE AGENCY'S, NOT CARF'S

`ACCESS_DAYS`, `PLAN_DAYS`, `REVIEW_DAYS`, `NOTE_HOURS`, `DISCHARGE_DAYS`, `FOLLOWUP_DAYS`,
`RETENTION_YEARS` default to reasonable values and are listed as **defaulted decisions** in the
blanks report. They are organizational choices. **State licensure rules and payer contracts are
often stricter, and the strictest one wins.** Always tell the user to check them; never present a
default as a CARF requirement. Override them in a `timeframes` object in `provider.json`.

## WHEN THE USER ASKS "WILL THIS PASS?"

Answer honestly. Documents are necessary and not sufficient. CARF looks for **evidence the
organization has been operating this way** — data trends, four quarters of record reviews, drill
logs across every shift, a completed annual performance analysis, and proof the results reached
staff and persons served. Confirm the minimum operating period in the purchased manual and the
Survey Application, then count backwards. A provider that wrote perfect policies last month is
not ready, and telling them otherwise wastes their survey fee.

The five findings that most often bite (also in `00_START_HERE.md`):
1. Goals written in staff language instead of the person's own words (2.C)
2. Drills on one shift only, and none unannounced (1.H)
3. Performance results never distributed to persons served (1.N)
4. Training documented but competency never demonstrated (1.I)
5. Findings identified but never verified as closed (2.H)

## HOUSE RULES

- **Never invent** a name, date, credential, licence number, or statistic. Blank it and log it.
- **Never claim** a document conforms to a standard. Say what the document does and what evidence
  it produces.
- **Never tell a provider they are ready** on the strength of the paperwork alone.
- **Never reproduce CARF text.** See rule 1.
- Rebuild rather than hand-edit. `python3 _engine/build_provider.py <slug>` is always safe.
