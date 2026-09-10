# Prayers of Care Inc — confirmed facts

Everything here was confirmed by the agency. Nothing is inferred. Anything not listed is still
unknown and must not be guessed.

| Field | Confirmed | Notes |
|---|---|---|
| Legal entity | **Prayers of Care Inc** | Incorporated. Confirmed. |
| Chief Executive Officer / Owner | **Nicky Ingram** | CEO and sole owner of the corporation |
| NPI | 1043895022 | |
| EIN | held in IDENTIFIERS.local.md | Not committed to the repository |
| Phone | (336) 509-5025 | |
| Alternate email | prayersofcare@outlook.com | |
| Consultant | Successful Solutions (Tom Garner) | **Consultant only** — not an officer or employee of Prayers of Care Inc |
| Governance | Incorporated; CEO-led, no board at this time | Owner performs governance functions personally and records them in the LEAD-01 Decision Log. See the corporation note below. |
| Workforce | Owner plus 4–10 people | Individual names, roles and hire dates not yet collected |
| Operating status | Already serving people | Service history exists — the evidence clock has started |
| Faith-based activity | **None** | Name-only. No prayer, worship or devotional activity offered as part of services |
| Medication management | **Not offered** | Confirmed. See the standing note below. |
| CARF program sought | Community Integration (3.C, p.185) | Section 3, Core Treatment Program Standards |

## Standing note — medication management

The agency confirmed that **no medication management is offered**. The whole packet depends on
that: policy 2E-01 states in print that the agency does not prescribe, dispense, administer,
store, transport or dispose of medication, and the builder's capability gate refuses to produce
a packet for a provider whose record says otherwise.

**If that ever changes** — including adding it to a payer contract — the following must happen
BEFORE any document goes out saying otherwise:

1. Set `administers_medication: true` in the provider record. The gate will refuse the build.
2. Write the medication management policy content, which does not exist in this engine yet.
3. Understand that CARF 2.E Medication Use (p.149–156, 8 pages) becomes fully applicable, and
   that this packet currently carries one policy for it.
4. Understand that **peer support specialists cannot deliver medication management**. It
   requires appropriately licensed staff, and it is likely outside the Community Integration
   program description — it may require a different or additional CARF program.
5. Check the agency's Medicaid enrollment, taxonomy and credentialed practitioners with the
   payer before billing anything.

## Corporation note

Confirmed: Prayers of Care Inc is incorporated, with **Nicky Ingram as CEO and owner**, and no
board at this time. A single-officer corporation is ordinary and is not in conflict with
"owner-operated".

**Outstanding:** the corporate records themselves — articles of incorporation, bylaws, the list
of officers and directors, and the annual consent or minute in place of a meeting. Those are
the evidence behind the governance answer. A surveyor who asks how the corporation is governed
should be handed the filed record rather than a verbal answer. File copies in the binder.

## Still needed before the full packet can be built

- DBA if the agency trades under a different name
- Physical address, city, state, ZIP; counties actually served
- Website, if there is one
- **Exact name of the state peer credential staff hold, and the issuing body** — needed on JD-02
  and on every credential verification. Confirm against the payer's own requirement, not just
  the state's; the payer sometimes requires more
- **Maximum active caseload per peer specialist**, and the reasoning behind the number
- **Documentation timeframe** — how many hours a peer specialist has to complete a note
- Which EHR the agency documents in
- Payers
- Target survey month
- **Date the program started delivering services** (drives every due date). A draft supplied by
  the consultant stated **November 2025**. That is not confirmed by the agency, so it was removed
  from STRAT-01 rather than carried forward. Confirm it with Nicky Ingram
- Shifts that deliver service, sites controlled, vehicles used
- Staff roster: name, role, hire date, credential — **the agency will supply this later**
- Whether a Program Supervisor is designated, and who
- Who holds Privacy Officer and Compliance Officer
- **What independent check exists on the Owner's own work, and where a complaint about the
  Owner goes.** This now blocks ETH-01 as well as ORG-01. Two things are needed: a real
  anonymous method (a locked box at a named location, or a free anonymous web form), and a
  named independent person outside the chain of command — the external accountant, the
  attorney, or the consultant
- Contact details for the external reporting routes: state licensing authority, the health plan
  or MCO, NC protection and advocacy, CARF, and the county DSS
- **Confirmation of NC mandatory reporting citations, receiving agency and timeframe** — for
  counsel or the county DSS to confirm, not a consultant
- Backup for the Owner / Executive Director
- Whether the Consumer-Run specialty designation (5.D, p.318) is being considered
- **CEO FLSA status and employment status** — a question for the accountant, not a template
- **Does the CEO deliver direct peer support?** If yes: her credential must be verified, she
  needs supervision and competency assessment like any other staff member, and someone other
  than her must review her documentation
- Licence types, numbers and insurance policies held (JD-01 section 3, item 14)
- **Folder path where leadership minutes are filed**, who may access them, and where the
  backup copy is held (MTG-01 section J)
- **Record retention period in the payer contract and under NC rules** — MTG-01 sets three
  years from LEAD-01; if either the contract or the state requires longer, the longer wins
- **The ten strategic-planning inputs in STRAT-01 section 3** — surveys, community data, budget,
  technology, workforce, risk and performance results, each with the date gathered. This is the
  part of 1.C that is actually tested; goals without it are opinions
- Budget figures, training budget, insurance, and **the external accountant or bookkeeper who
  provides the second look on finances** — separation of duties in a one-owner agency (1.F)
- Which position owns community partnerships (STRAT-01 Goal 4) and health and safety (Goal 5)

## Binder progress

| Doc | Title | CARF area | Status |
|---|---|---|---|
| MVV-01 | Mission, Vision and Values | 1.A | Draft — awaiting adoption signature |
| ORG-01 | Organizational Chart and Function Assignment | 1.A, 1.I, 2.A | Draft — awaiting staff roster |
| LEAD-01 | Leadership Policy | 1.A | Draft — awaiting backup name and Program Supervisor |
| JD-01 | Job Description — CEO / Owner | 1.I, 1.A | Draft — awaiting FLSA/employment status from the accountant |
| JD-02 | Job Description — Peer Support Specialist | 1.I, 2.A, 2.C, 3.C | Draft — awaiting credential name, caseload cap, note timeframe |
| ETH-01 | Code of Ethics and Conduct | 1.A, 1.J, 1.I | Draft — **blocked**: cannot be adopted until the reporting routes are named |
| MTG-01 | Leadership Meeting — Agenda and Minutes | 1.A | Draft — awaiting Program Supervisor name, minutes filing path, and the ETH-01 independent person |
| STRAT-01 | Strategic Plan — three-year | 1.C | Draft — **blocked on section 3**: goals cannot be adopted before the inputs behind them are recorded |
