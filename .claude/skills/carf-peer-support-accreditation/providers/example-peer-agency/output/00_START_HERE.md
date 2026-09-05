# START HERE — Example Peer Recovery Services, Inc.
### Your CARF accreditation system, and exactly what to do with it

Generated 2026-09-05. Target survey: 2027-06.

---

## First, the two things you must know

**1. Nobody here has read your CARF manual.** CARF's standards are copyrighted and sold by
CARF. This packet is organized to the manual's long-standing structure and is written from
scratch — it is not a copy of the standards and it is not a substitute for buying the manual.
Buy the 2026 Behavioral Health Standards Manual from carf.org, check the section
map, then set `manual_verified: true` and rebuild. Until you do, every document says DRAFT.

**2. CARF accredits PROGRAMS, not job titles.** There is no "peer support accreditation."
You apply for a program — for you, **Community Integration** — and peer support is the workforce
and the service model that delivers it. The peer-specific requirements live in Section 1.I
(credential, competency, supervision), Section 2.A and 2.C (program description, planning with
the person), and the Section 3 program standards. This packet covers all of them, and adds a
cross-cutting peer section so nothing peer-specific falls between the cracks.

---

## What is in this folder

| File | What it is | What to do with it |
|---|---|---|
| `BLANKS_TO_COMPLETE.md` | Everything missing or defaulted | **Read this before anything else** |
| `01_Policy_and_Procedure_Manual` | 58 policies, organized by CARF area | Read, edit to fit you, adopt, sign |
| `02_Annual_Plans` | The 12 written plans CARF expects | Fill in every [BRACKET], sign, date |
| `03_Forms_Packet` | 72 forms the policies refer to | Print the ones you will actually use |
| `04_Roadmap_and_Survey_Prep` | 12-month countdown, training matrix, evidence binder index | Work the roadmap |
| `05_Self_Study_Checklist.xlsx` | Every required document, with a status column | Your conformance tracker |
| `06_Surveyor_Interview_Bank` | What surveyors ask staff and the people you serve, with the shape of a strong answer and what sinks you | Rehearse with it 60 days out |
| `07_Performance_Analysis_Report` | Built from YOUR data, with charts | Re-run it monthly |
| `08_Manual_Verification_Worksheet` | One page per CARF area to check against your purchased manual | **This is what clears the DRAFT stamp** |

And one level up, in **`../data/`**:

| File | What it is |
|---|---|
| `Evidence_and_Data_Workbook.xlsx` | **The spine of the whole thing.** 592 dated required items, a compliance calendar, 12 data logs, the measure set, and the evidence register |

---

## Do it in this order

**Step 1 — Buy the manual.** carf.org. You cannot do this properly without it.

**Step 2 — Open `BLANKS_TO_COMPLETE.md`.** Fill in what is missing in
`providers/example-peer-agency/provider.json`, then rebuild:
`python3 _engine/build_provider.py example-peer-agency`. Do not hand-edit the Word files
first — a rebuild overwrites them. (Your workbook is never overwritten.)

**Step 3 — Verify the section map** using `08_Manual_Verification_Worksheet`. Print it, sit
down with the manual, and work the 24 area pages — an hour or two. It asks, for each area:
does it appear in your manual under this letter and name, does the description match, and is
there anything in your manual that none of these policies covers. Make its corrections to
`_engine/content/meta/standards_map.json`, put its gaps on the checklist, sign the last page,
set `manual_verified: true`, and rebuild. The DRAFT stamp disappears.

Do not sign that page unless someone actually did the work. The stamp is a protection, not
an inconvenience — it stops a document reaching a surveyor claiming an alignment nobody checked.

**Step 4 — Read the whole policy manual.** Every policy is a statement about your agency.
Change anything that is not true of you. Where it describes what you *intend* to do, change
your practice to match — or change the policy.

**Step 5 — Adopt it.** Your governing body approves the manual in a meeting, and it goes in
the minutes. Date every policy.

**Step 6 — Open the workbook and work sheet `01 MASTER CHECK-OFF LIST`.**
It has **592 dated items** — every drill, every review, every survey, every plan, every
report — with the date each is due and who owns it.
Filter Status = OVERDUE and start there.

**Step 7 — Start generating evidence today.** This is the part people get wrong. CARF does not
want to see that you wrote a policy last month. It wants to see that you have been *running*
this — drills, record reviews, supervision notes, incident analyses, satisfaction results, a
completed annual analysis. Enter each one in the workbook the day it happens.

**Step 8 — Run the analysis monthly.**
`python3 _engine/analyze.py example-peer-agency`
That reads your workbook and produces `07_Performance_Analysis_Report` with real charts,
real trends, and an honest list of what is still missing. It never invents a number.

**Step 9 — Mock survey, at least 60 days out.** Use `06_Surveyor_Interview_Bank`. Have someone
outside the program ask the questions. Write down the real answers. Every shrug is a gap —
and you have found it before the surveyor did.

---

## The five things that most often go wrong

1. **Goals written in staff language.** A surveyor reads a goal aloud and asks the person
   served if those are their words. Write goals in quotation marks, in the person's voice.
2. **Drills on one shift only.** Every shift that delivers service needs drills, and at least
   one a year must be unannounced.
3. **Results never shared.** Analysing performance is half of area 1.N. Telling staff and the
   people you serve what you found is the other half, and it is the most-missed requirement
   in the manual.
4. **Training with no competency.** A sign-in sheet proves attendance. CARF asks how you know
   the person can do the work. Direct observation, documented.
5. **Findings that were never closed.** Finding a problem is half. The tracker must show
   somebody verified the fix.

---

## About the blanks on the forms

Every form in this packet ships with **no dates and no scores filled in**. That is
deliberate. A date printed on a form is either wrong, or it invites someone to sign off
on something that did not happen that day — and that is how a paperwork gap turns into a
falsified record. Fill each date in when the thing actually happens, in the hand of the
person who did it.

The only dates already written down are in the workbook's check-off list and calendar,
and those say when something is **due**. They never claim it was done.

## The one rule that matters more than all of this

**Never write a date for something that did not happen, and never enter a number you cannot
trace to a source.** A gap you can explain is survivable at survey. A fabricated record is
fraud, and it is the one thing that ends an agency. Every tool here is built to make a gap
visible rather than paper over it — that is the point of it.
