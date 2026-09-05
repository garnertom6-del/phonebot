# CARF Accreditation Packet Builder

Takes a peer-support-delivered behavioral health provider from nothing to survey-ready.
One engine, many providers. **The only thing that changes per provider is one JSON file.**

## Quick start

```bash
# 1. Create the provider record (or open PROVIDER_INTAKE_FORM.html and let them fill it in)
mkdir -p providers/my-client
cp providers/EXAMPLE_provider.json providers/my-client/provider.json
#    edit it

# 2. Build
python3 _engine/build_provider.py my-client

# 3. Everything lands in providers/my-client/output/
#    Read 00_START_HERE.md first, then BLANKS_TO_COMPLETE.md
```

Requires Python 3 and `pip install python-docx reportlab openpyxl`. Nothing else — PDFs are
generated natively, so LibreOffice and Word are not needed anywhere.

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

`TRACKER.csv` at the skill root carries one row per provider, sorted by target survey month.

## The three rules

1. **No CARF text, ever.** The standards are copyrighted and sold by CARF. Nothing in
   `_engine/content/` is copied from the manual. The provider must buy the current *Behavioral
   Health Standards Manual* from carf.org.
2. **Nothing is verified until a human verifies it.** `manual_verified: false` stamps every page
   DRAFT. Only a person with the purchased manual open sets it to `true`.
3. **CARF accredits programs, not job titles.** There is no peer support accreditation. Peer
   support is the workforce that delivers a program — usually **Community Integration**.

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
