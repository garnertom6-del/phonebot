# BLANKS TO COMPLETE — Example Peer Recovery Services, Inc.

Generated 2026-09-05.  **Read this first.**

This packet never invents a name, a date, a credential, or a number. Everything below is either missing from the provider record or is a choice the agency has to confirm. Nothing here is optional.

## 0. The verification gate

- [ ] **THE SECTION MAP HAS NOT BEEN VERIFIED.** Every document in this packet is stamped DRAFT until it is.

  This skill organizes your documents by the CARF Behavioral Health Standards Manual's long-standing outline. It does **not** contain CARF's copyrighted standard text, and nobody here has read your edition. Do this:

  1. Buy the 2026 Behavioral Health Standards Manual from carf.org.
  2. Open **`08_Manual_Verification_Worksheet`** — it exists for exactly this job. One page per area: what this packet assumed, a blank for what your manual really says, and a box for standards nothing here covers.
  3. Work it with the manual open beside you. Expect an hour or two.
  4. Make the corrections it produces to `_engine/content/meta/standards_map.json`, and put every gap it finds on the self-study checklist with an owner and a date.
  5. Sign its last page, set `manual_verified: true` in provider.json, and rebuild.

  Do not sign that page unless someone actually worked every page of it. The DRAFT stamp is a protection: it stops a document reaching a surveyor claiming an alignment nobody confirmed.

## 1. Missing from the provider record

Each of these prints as a blank line in the documents. Add it to `provider.json` and rebuild — do not hand-edit the Word files, or the next build will overwrite you.

| Field in provider.json | What it is | Why it matters |
|---|---|---|
| `ceo` | Chief Executive Officer name | signature blocks throughout |
| `program_director` | Program Director name | policy owners, survey interviews |
| `clinical_supervisor` | Supervisor of the peer workforce | supervision and competency policies |
| `qi_coordinator` | Quality Improvement Coordinator | all Section 1.M and 1.N documents |
| `safety_officer` | Safety Officer | Health and Safety Plan, drills, incidents |
| `privacy_officer` | Privacy Officer | confidentiality, breach response, records |
| `compliance_officer` | Compliance Officer | Corporate Compliance Plan |

## 2. Decisions we defaulted — confirm each one

These are **your agency's operational choices**, not CARF numbers. The default is a reasonable starting point. Your state licensure rule or a payer contract may be stricter, and the strictest one wins. Once confirmed, put them in a `timeframes` object in provider.json and rebuild.

| Token | Default used | What to check |
|---|---|---|
| `ACCESS_DAYS` | 3 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `PLAN_DAYS` | 30 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `REVIEW_DAYS` | 90 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `NOTE_HOURS` | 24 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `DISCHARGE_DAYS` | 10 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `FOLLOWUP_DAYS` | 30 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |
| `RETENTION_YEARS` | 7 | organizational timeframe -- confirm against your state licensure rule and every payer contract; the strictest one wins |

## 3. Bracketed blanks inside the documents

The annual plans and several forms carry `[SQUARE BRACKET]` prompts that only the agency can answer — budget figures, insurance carriers, drill dates, demographic percentages, caseload rationale. Work through them plan by plan. **A plan handed to a surveyor with brackets still in it is worse than no plan.**

## 4. Signatures

Every policy carries an approval line and every plan a signature line. They are left blank deliberately. Nobody signs on the agency's behalf but the agency.

## 5. Read before adopting

These documents make flat factual claims about your agency — that it does not administer medication, does not use restraint, does or does not transport people. Those sentences are true only because your provider record says so. Read them. If one is not true of you, fix the record and rebuild; never edit the sentence out.
