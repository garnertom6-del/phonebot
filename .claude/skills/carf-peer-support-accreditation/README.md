# CARF Accreditation Packet Builder

Takes a peer-support-delivered behavioral health provider from nothing to survey-ready.
One engine, many providers. **The only thing that changes per provider is one JSON file.**

## Quick start

```bash
# 1. Interview the provider (_engine/content/meta/intake-interview.md is the script),
#    or hand them PROVIDER_INTAKE_FORM.html to fill in themselves.
mkdir -p providers/my-client
cp providers/EXAMPLE_provider.json providers/my-client/provider.json
#    edit it

# 2. Build the documents, the dated check-off list, and the empty data workbook
python3 _engine/build_provider.py my-client

# 3. The provider works providers/my-client/data/Evidence_and_Data_Workbook.xlsx,
#    entering real events as they happen.

# 4. Analyse whatever they have entered - monthly
python3 _engine/analyze.py my-client
```

Requires Python 3 and `pip install python-docx reportlab openpyxl matplotlib pillow`.
Nothing else — PDFs and charts are generated natively, so LibreOffice and Word are not
needed anywhere.

Re-running step 2 is always safe: it rebuilds every document from `provider.json` and
**never overwrites a workbook that already has data in it**.

## What comes out

| File | Pages (example build) | What it is |
|---|---|---|
| `00_START_HERE.md` | — | The walkthrough. Give the client this first. |
| `BLANKS_TO_COMPLETE.md` | — | Verification gate, missing fields, defaulted decisions |
| `01_Policy_and_Procedure_Manual` (.docx + .pdf) | ~68 | 58 policies by CARF area, each with owner, review cycle, and the evidence a surveyor asks for |
| `02_Annual_Plans` (.docx + .pdf) | ~24 | The 12 written plans CARF expects |
| `03_Forms_Packet` (.docx + .pdf) | ~79 | 72 forms and tools |
| `04_Roadmap_and_Survey_Prep` (.docx + .pdf) | ~14 | 12-month countdown, training matrix, mock survey guide, evidence binder index |
| `05_Self_Study_Checklist.xlsx` | — | Every required document with owner, status, gap, due date; plus an interview-prep sheet |
| `06_Surveyor_Interview_Bank` (.docx + .pdf) | ~16 | ~65 real surveyor questions by role, each with what is being tested, the shape of a strong answer, what sinks you, and the document they ask for next |
| `07_Performance_Analysis_Report` (.docx + .pdf) | varies | Built by `analyze.py` from the provider's own data: charts, trends against target, drill coverage by shift, incident/grievance trends, record-review defects, access times, satisfaction, outcomes, workforce compliance — and an honest "no data yet" wherever a sheet is empty |
| `08_Manual_Verification_Worksheet` (.docx + .pdf) | ~29 | One page per CARF area to check against the purchased manual, plus the sign-off that clears the DRAFT stamp |
| `../data/Evidence_and_Data_Workbook.xlsx` | — | **The spine.** A dated MASTER CHECK-OFF LIST of every required item (typically 550–700 instances), a month-by-month compliance calendar, 12 data logs, the measure set, and the evidence register |

`TRACKER.csv` at the skill root carries one row per provider, sorted by target survey month.

## The check-off list

`_engine/content/meta/obligations.json` holds 136 recurring obligations across 14 sections.
`calendar_engine.py` expands them into dated instances from the provider's `cycle_start`,
multiplying by `shifts` (drills are required on every shift), `sites` (quarterly inspections),
`vehicles` (monthly inspections) and `staff` (supervision, competency, appraisal, wellness
plan per person). Each instance carries its due date, owner, the evidence that proves it,
and a status of OVERDUE / due within 30 days / upcoming.

## Every date and every score ships blank

No form leaves the engine with a date or a rating already in it — not the build date, not
the provider's target survey month, not a specimen score. A pre-printed date is either
wrong or an invitation to sign off on something that did not happen that day.

`assert_blank_dates()` scans every form and plan after token substitution and **refuses
the build** (exit 3) if any real date format appears in the body, naming the form and
showing the surrounding text. Rating scales ship as header rows with empty cells.

Computed dates — the due dates on the check-off list and compliance calendar — live in
the workbook only. They say when something is **due**; they never assert it was **done**.

## The three rules

1. **No CARF text, ever.** The standards are copyrighted and sold by CARF. Nothing in
   `_engine/content/` is copied from the manual. The provider must buy the current *Behavioral
   Health Standards Manual* from carf.org.
2. **Nothing is verified until a human verifies it.** `manual_verified: false` stamps every page
   DRAFT. Only a person with the purchased manual open sets it to `true`.
3. **CARF accredits programs, not job titles.** There is no peer support accreditation. Peer
   support is the workforce that delivers a program — usually **Community Integration**.

And one rule for the data side: **never enter a provider's data for them, and never let a
report imply an event happened.** An empty sheet produces an honest "no data entered yet"
block. A gap you can explain survives a survey; a fabricated drill date does not.

See `SKILL.md` for the full reasoning behind each, and for the capability gate.

## Editing the content

Every policy, plan, and form is a plain Markdown file under `_engine/content/`, with a small
front-matter block and `{{TOKENS}}` for anything provider-specific. Edit the file, rebuild, and
every provider picks up the change.

```
_engine/content/policies/1K-01.md    Rights of the Persons Served
_engine/content/plans/risk.md        Risk Management Plan
_engine/content/forms/grievance-form.md
_engine/content/meta/standards_map.json   the area map + surveyor questions
```

Supported Markdown: `#`/`##`/`###`, `**bold**`, `-` bullets, `1.` numbered, `|` tables, `---`.

## Adding a new CARF program

1. Write the Section 3 policies for it under `_engine/content/policies/`.
2. Add an area entry to `_engine/content/meta/standards_map.json` referencing them.
3. Add the program key to `SUPPORTED["programs"]` in `_engine/resolve.py`.

Do it in that order. The gate exists so a provider is never built against content that
contradicts what the provider actually does.
