---
name: carf-peer-support-accreditation
description: "Run a provider all the way to CARF accreditation, over and over, from one JSON record. Interviews the provider section by section (finance, technology, HR, safety, rights, records, peer workforce), then builds: the Policy and Procedure Manual (58 policies by CARF area), the 12 annual written plans, the 72-form packet, the surveyor interview bank with model answers for staff AND persons served, the 12-month roadmap, the training matrix, the evidence binder index, the self-study checklist, a dated MASTER CHECK-OFF LIST of every required item/drill/review/survey with due dates and overdue flags, an Evidence and Data Workbook the provider fills in, and a Performance Analysis Report with real charts, trends and measured data computed from what they entered. Use when the user wants to get a provider CARF accredited or ready for survey, add or onboard a provider, mentions CARF, the Behavioral Health Standards Manual, ASPIRE to Excellence, a CARF survey or resurvey, Community Integration, peer support accreditation, a self-study, readiness assessment, mock survey, compliance calendar, CARF analysis or trends, or a CARF Quality Improvement Plan."
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

`_engine/content/meta/standards_map.json` carries the area letters, names and manual page numbers.
**As of this build they are checked against the real 2026 Behavioral Health Standards Manual table
of contents** (July 1, 2026 – June 30, 2027), supplied by the user.

Six things the check corrected, which is why the gate exists:

| Assumed | Actually |
|---|---|
| 1.I Human Resources | **1.I Workforce Development and Management** |
| 1.J Technology | **No Technology area exists in Section 1.** Section 1 runs A–M, 13 areas |
| 1.K Rights / 1.L Accessibility / 1.M Measurement / 1.N Improvement | **1.J / 1.K / 1.L / 1.M** — everything after Workforce shifted up a letter |
| 1.C Strategic Integrated Planning | **1.C Strategic Planning** |
| 2.H Quality Records Review | **2.H Quality Records Management** |
| Section 2 ends at 2.H | **2.I Service Delivery Using Information and Communication Technologies** — a whole area that was missing |
| 3.CI Community Integration | **3.C Community Integration**, page 185, in Section 3 *Core Treatment* Program Standards |

Do the same for any other edition. A map that is right for 2026 is not automatically right for 2027.

So the builder refuses to claim verification it does not have:

- `manual_verified: false` (the default) → every document is stamped **DRAFT — section map
  unverified**, and section 0 of `BLANKS_TO_COMPLETE.md` explains exactly how to verify.
- `08_Manual_Verification_Worksheet` is the instrument for doing it: one page per area, generated
  from `standards_map.json` so it can never drift from what the packet assumes.
- **Level 1 (area map correct) is done for 2026. Level 2 (coverage complete) is not.** Nobody has
  read the standards inside each area. Box 4 on every worksheet page - "standards in YOUR manual
  that nothing above covers" - is still entirely unanswered.
- Only a human, with the purchased manual open, sets it to `true`.
- The worksheet tells them **not to copy manual text into it** — a standard number and their
  own few words is all anyone needs, and it keeps them clear of the copyright line too.

**Never set `manual_verified: true` on the user's behalf.** Never say "verified against the 2026
manual" unless the user tells you they did it.

### 3. THE PEER SUPPORT NAMING TRAP

**CARF does not accredit "peer support."** There is no peer support accreditation to apply for.
Confirmed twice: the 2026 table of contents has no Peer Support program in Section 3 or 4, and
CARF's own 2026 Behavioral Health Program Descriptions mention peer support once in 23 pages, as
staffing for a crisis contact center.

**But there is a designation worth knowing about.** Section 5 is Specialty Designation Standards,
and **5.D is Consumer-Run** (page 318) — a designation layered on a program, about the persons
served participating in the direction of the service itself. For a genuinely peer-directed agency
that is the closest thing CARF has, and it may belong on the application alongside 3.C. Ask.
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

## THE TWO WAYS TO USE IT

**Lane A — build the packet.** `build_provider.py` produces every document plus the
dated check-off list and the empty data workbook. Run it as soon as you have a
provider record; run it again any time the record changes.

**Lane B — analyse their evidence.** Once the provider has entered real data in the
workbook, `analyze.py` reads it back and produces the Performance Analysis Report
with charts, trends and gap findings. Run it monthly. It never invents a number: an
empty sheet produces a "NO DATA ENTERED YET" block naming the sheet and what it proves.

```
python3 _engine/build_provider.py <slug>      # lane A - documents + checklist + workbook
python3 _engine/analyze.py       <slug>       # lane B - analysis from their real data
```

`build_provider.py` **never overwrites a workbook that already has data in it.** It
says so and moves on. Pass `--new-workbook` to build a fresh one alongside.

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
| `06_Surveyor_Interview_Bank` | ~65 real surveyor questions by role — CEO, board, program director, supervisor, peer specialists, persons served, billing — each with what the surveyor is really testing, the shape of a strong answer, what sinks you, and the document they ask for next. Plus the mock-survey scoring sheet. |
| `07_Performance_Analysis_Report` | Produced by `analyze.py` from the provider's own entered data: charts, quarterly trends against target, drill coverage by shift, incident and grievance trends, record review scores and defect ranking, access times, satisfaction by question, outcomes by life domain, natural-supports growth, workforce compliance, accessibility progress, PI projects — and an honest "no data yet" block wherever a sheet is empty |
| `08_Manual_Verification_Worksheet` | One page per CARF area: the letter and name this packet assumed, a blank for what the purchased manual actually says, whether the description matches, which bundled documents claim to cover it, and a box for standards nothing here covers. Plus a section-level check, an edition-changes table, and the sign-off that clears the DRAFT stamp. |
| `../data/Evidence_and_Data_Workbook.xlsx` | **The spine.** Sheet 01 is the MASTER CHECK-OFF LIST — every required item, drill, review, survey, plan and report, expanded into dated instances with owner, evidence, status and overdue flag. Sheet 02 is the same by month. Sheets 03–14 are the data logs. Sheet 15 is the measure set. Sheet 16 is the evidence register. |

DOCX and PDF for 01–04, 06 and 07. PDFs are generated natively by ReportLab — the packet never
depends on LibreOffice or Word being installed.

## THE CHECK-OFF LIST AND THE CALENDAR

`_engine/content/meta/obligations.json` holds 136 recurring obligations across 14 sections
(governance, strategy, legal, finance, risk, safety, HR, technology, rights, accessibility,
performance, service delivery, records, peer workforce). `calendar_engine.py` expands them
into dated instances from the provider's `cycle_start`, multiplying by the things that
multiply:

- **`shifts`** — fire and evacuation drills are required on every shift that delivers service
- **`sites`** — each needs its own quarterly safety inspection
- **`vehicles`** — each needs a monthly inspection
- **`staff`** — supervision, competency, appraisal, disclosure plan and wellness plan expand per person

A typical small agency lands around 550–700 dated items. Each carries the evidence that
proves it, the owner, and a status of OVERDUE / due within 30 days / upcoming.

## THE TIMEFRAMES ARE THE AGENCY'S, NOT CARF'S

`ACCESS_DAYS`, `PLAN_DAYS`, `REVIEW_DAYS`, `NOTE_HOURS`, `DISCHARGE_DAYS`, `FOLLOWUP_DAYS`,
`RETENTION_YEARS` default to reasonable values and are listed as **defaulted decisions** in the
blanks report. They are organizational choices. **State licensure rules and payer contracts are
often stricter, and the strictest one wins.** Always tell the user to check them; never present a
default as a CARF requirement. Override them in a `timeframes` object in `provider.json`.

## PREPARING THEM FOR THE INTERVIEWS

`06_Surveyor_Interview_Bank` exists because leadership can describe a system the direct
staff have never experienced, and surveyors know it. When the CEO's answer and the peer
specialist's answer disagree, the surveyor believes the peer specialist.

Two rules to state every time you hand it over:

1. **These are not scripts.** A rehearsed line from someone who does not do the thing is
   worse than an honest "I'd have to check" — it turns a documentation gap into a
   credibility problem, and that spreads to every other answer. Use the model answers as
   the *shape* of a good answer; the brackets are facts the person supplies from their own
   work. If they cannot fill the brackets, that is the finding, and you found it first.
2. **Never coach a person served.** Ask if they are willing to talk, say it is voluntary
   and that nothing changes either way, then leave them alone. Coaching is a rights
   violation on its own terms and the fastest way to lose an accreditation.

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

## EVERY DATE AND EVERY SCORE SHIPS BLANK

A form leaves this engine with **no date and no score already written in it**. Not the
date it was generated, not the provider's target survey month, not a specimen rating.

The reason is not tidiness. A date printed on a form is either wrong, or it is an
invitation to sign off on something that did not happen on that day — and a signed form
carrying a date nobody checked is exactly the artefact that turns a documentation gap
into a falsified record. The same goes for a score: a rating scale with a value already
in it is a suggestion, and a surveyor reading an identical rating down a column knows
what happened.

This is enforced, not trusted:

- `assert_blank_dates()` scans every form and plan **after** token substitution and
  **refuses the build** if any real date format (`2027-03-15`, `3/15/27`, `March 15, 2027`)
  appears in the body. Exit code 3, with the offending form and the surrounding text.
- Rating scales ship as header rows with empty cells. Totals, percentages and score
  boxes ship as blank lines.
- Dates that are *computed*, not filled — the due dates on the check-off list and the
  compliance calendar — live in the workbook, never on a form. Those say when something
  is **due**; they never assert that it was **done**.

The only dates in a generated document are the build stamp in the footer and on the
title page, which describe when the file was produced and are not fields anyone signs.

When you add a form: write `Date: ____________`, never a date. When a plan needs a
target date, write `[DATE]`. The guard will catch you if you forget.

## HOUSE RULES

- **Never invent** a name, date, credential, licence number, or statistic. Blank it and log it.
- **Never pre-fill a date or a score on a form.** See the section above. The build enforces it.
- **Never enter data into the workbook on the provider's behalf**, and never let a report
  imply an event happened. A gap you can explain survives a survey; a fabricated drill date
  or satisfaction score is fraud, and it is the one thing that ends an agency. If a provider
  asks you to "just fill in" a log so it looks complete, decline and say why — then help them
  build the real record from whatever they actually have.
- **Never claim** a document conforms to a standard. Say what the document does and what evidence
  it produces.
- **Never tell a provider they are ready** on the strength of the paperwork alone.
- **Never reproduce CARF text.** See rule 1.
- Rebuild rather than hand-edit. `python3 _engine/build_provider.py <slug>` is always safe.
