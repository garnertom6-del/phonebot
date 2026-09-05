# START HERE — Example Peer Recovery Services, Inc.
### Your CARF accreditation packet, and exactly what to do with it

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
cross-cutting peer section (3.PEER) so nothing peer-specific falls between the cracks.

---

## What is in this folder

| File | What it is | What to do with it |
|---|---|---|
| `BLANKS_TO_COMPLETE.md` | Everything missing or defaulted | **Read this before anything else** |
| `01_Policy_and_Procedure_Manual.docx` | 58 policies, organized by CARF area | Read, edit to fit you, adopt, sign |
| `02_Annual_Plans.docx` | The 12 written plans CARF expects | Fill in every [BRACKET], sign, date |
| `03_Forms_Packet.docx` | 72 forms the policies refer to | Print the ones you will actually use |
| `04_Roadmap_and_Survey_Prep.docx` | 12-month countdown, training matrix, mock survey guide, evidence binder index | Work the roadmap; rehearse with the guide |
| `05_Self_Study_Checklist.xlsx` | Every required document, with a status column | Your master tracker until survey day |
| PDFs | Print-ready versions | Hand to the board, the surveyor, staff |

---

## Do it in this order

**Step 1 — Buy the manual.** carf.org. You cannot do this properly without it. Budget for it.

**Step 2 — Open `BLANKS_TO_COMPLETE.md`.** Fill in what is missing in
`providers/example-peer-agency/provider.json`, then rebuild:
`python3 _engine/build_provider.py <slug>`. Do not hand-edit the Word files first — a rebuild
overwrites them.

**Step 3 — Verify the section map** against the manual. Set `manual_verified: true`. Rebuild.
The DRAFT stamp disappears.

**Step 4 — Read the whole policy manual.** Every policy is a statement about your agency.
Change anything that is not true of you. Where the policy describes what you *intend* to do,
change your practice to match — or change the policy.

**Step 5 — Adopt it.** Your governing body approves the manual, in a meeting, and it goes in
the minutes. Date every policy.

**Step 6 — Start generating evidence today.** This is the part people get wrong. CARF does not
want to see that you wrote a policy last month. It wants to see that you have been *running*
this — data, drills, record reviews, supervision notes, incident analyses, a completed annual
analysis. That takes months of real operation. Open the roadmap and start the clock.

**Step 7 — Work `05_Self_Study_Checklist.xlsx` weekly.** Every row gets a "yes" and a date.

**Step 8 — Mock survey, at least 60 days out.** Use the interview guide in document 04. Have
someone outside the program ask the questions. Write down the real answers. Every shrug is a gap.

---

## The five things that most often go wrong

1. **Goals written in staff language.** A surveyor will read a goal aloud and ask the person
   served if those are their words. Write goals in quotation marks, in the person's voice.
2. **Drills on one shift only.** Every shift that delivers service needs drills, and at least
   one a year must be unannounced.
3. **Results never shared.** Section 1.N asks not only that you analyze performance, but that
   you tell staff, persons served, and stakeholders what you found. Document the distribution.
4. **Training with no competency.** A sign-in sheet proves attendance. CARF asks how you know
   the person can actually do the work. Direct observation, documented.
5. **Findings that were never closed.** Finding a problem is half. The tracker must show
   somebody verified the fix.

---

## When you are stuck

Re-run the builder any time — it is safe and it always rebuilds from `provider.json`:

```
python3 _engine/build_provider.py <slug>
```

Everything lands in `providers/<slug>/output/`.
