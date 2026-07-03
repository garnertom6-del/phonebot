# Mental Health Provider Automation System — Plan

**Target:** Behavioral health providers billing NC Medicaid (NCDHHS), operating under
NC Clinical Coverage Policies (8A / 8C service definitions), Standard Plans and
Tailored Plans / LME-MCOs (Trillium, Vaya, Alliance, Partners).

**Guiding rule:** The system **drafts, tracks, and checks — the clinician reviews and
signs.** Every note, assessment, PCP, and crisis plan must reflect services actually
rendered and be approved by the credentialed staff member before it is filed or billed.
Automation that fabricates or auto-signs documentation is Medicaid fraud; nothing here
does that.

---

## 1. What can be automated (the list)

### A. Intake & admission
| # | Task | Automation |
|---|------|-----------|
| 1 | Referral capture | Phone bot / web form collects demographics, insurance, presenting problem, referral source 24/7 |
| 2 | Medicaid eligibility verification | Automated 270/271 eligibility check against NCTracks / the member's plan before the first appointment, re-checked monthly |
| 3 | Consent & intake paperwork | E-signature packets (HIPAA notice, consent to treat, ROI, financial agreement) sent automatically via DocuSign; chased with SMS reminders until signed |
| 4 | Insurance card / ID capture | Photo upload + OCR into the client record |
| 5 | Screening tools | PHQ-9, GAD-7, ASAM, CANS/child measures sent as digital forms; auto-scored and dropped into the chart |
| 6 | Intake scheduling | Self-scheduling link + automated confirmation and reminder calls/texts (the existing Twilio bot does this today for another domain) |

### B. Clinical documentation (the big win)
| # | Task | Automation |
|---|------|-----------|
| 7 | Comprehensive Clinical Assessment (CCA) drafting | Clinician records or dictates the intake interview; Claude produces a structured CCA draft (presenting problem, history, mental status, diagnosis rationale, medical-necessity language, recommendations) for clinician edit/sign |
| 8 | Person-Centered Plan (PCP) drafting | Generates a draft PCP in the NC-required format from the CCA: long-range outcome, measurable short-range goals, interventions tied to the service definition, target dates, responsible staff. Clinician + client finalize |
| 9 | Crisis plan drafting | Auto-drafts the crisis plan section (triggers, warning signs, de-escalation preferences, supports, emergency contacts, mobile crisis / 988 info) from assessment data |
| 10 | Service / progress notes | Clinician dictates 60 seconds after session (or ambient-records with consent); Claude produces a note in the required structure: service, date, start/stop time, goal addressed, interventions, client response, plan — formatted for ShareNote, NoteNetic, or printable paper note |
| 11 | Golden-thread enforcement | Every draft note is checked against the active PCP: does it reference an authorized goal? Does the service match the authorization? Flags mismatches before signing |
| 12 | Paper-note digitization | Scanned handwritten notes OCR'd, transcribed, and filed to the right client/date; flagged if required elements are missing |
| 13 | Discharge / transition summaries | Drafted automatically from the chart history at discharge |

### C. Compliance & deadlines
| # | Task | Automation |
|---|------|-----------|
| 14 | Due-date tracking | Automatic clock on every compliance timer: PCP completion (30 days), PCP annual review, CCA updates, service order renewals, crisis plan reviews — dashboard + escalating reminders to staff |
| 15 | Authorization tracking | Tracks units used vs. authorized per client per service; alerts at 75% burn or 30 days before expiration; drafts the reauthorization request (TAR) package for the LME-MCO/plan |
| 16 | NC-TOPPS reminders | Tracks initial and update interview due dates per enrolled client |
| 17 | Note audit / self-audit | Nightly automated audit: unsigned notes, missing credentials, overlapping session times, duration/unit mismatches, notes without a linked goal — exactly what a plan auditor checks |
| 18 | Incident report drafting | Structured incident intake form → drafted IRIS-style report for supervisor review within the required window |
| 19 | Staff credential tracking | License expirations, required trainings (e.g., crisis intervention refreshers), supervision-hour logs, with automatic reminders |

### D. Operations & billing
| # | Task | Automation |
|---|------|-----------|
| 20 | Appointment reminders & no-show follow-up | Automated voice/SMS reminders (24h + 2h), instant rebooking flow after a no-show |
| 21 | Claim scrubbing | Before submission: correct CPT/HCPCS per the service definition, modifiers, diagnosis linkage, auth number present, note signed — rejects internally before the payer can deny |
| 22 | Denial follow-up | Parses remittances, categorizes denial reasons, drafts appeal letters with the supporting documentation attached |
| 23 | Caseload & productivity dashboards | Per-clinician view of notes due, sessions delivered vs. authorized, documentation lag time |
| 24 | After-hours phone line | The phone bot answers after hours, does warm screening, gives crisis callers 988/mobile-crisis info immediately and pages the on-call clinician, and books routine callers |

---

## 2. How it will be built

### Architecture
```
Client / Staff
   │
   ├── Phone & SMS  ──►  Twilio  ──►  Flask app (extends current app.py)
   ├── Web forms    ──►  Intake portal (Flask + HTML forms / e-sign via DocuSign)
   │
   ▼
Core service (Python/Flask)
   ├── Claude API (claude-sonnet-5 / claude-fable-5) — drafting CCA, PCP, crisis
   │     plans, notes, summaries, appeal letters; audit/QA passes
   ├── PostgreSQL — clients, episodes, authorizations, deadlines, audit log
   ├── Scheduler (cron/worker) — reminders, nightly audits, eligibility re-checks
   └── Export layer — PDF (paper notes, PCP on the state form), and formatted
         text/CSV for pasting or importing into ShareNote / NoteNetic
```

### Integration reality check
- **ShareNote / NoteNetic** do not offer open public APIs. Realistic integration is:
  (a) generate documentation in their exact field structure so staff paste it in,
  (b) CSV/PDF import-export where supported, or (c) browser automation as a last
  resort. The system is designed EHR-agnostic so it also works fully standalone
  with its own PDF paper-note output.
- **NCTracks eligibility**: via a clearinghouse (Availity, Claim.MD, etc.) using
  standard 270/271 transactions — no custom state integration needed.
- **Claims**: 837P generation through the same clearinghouse.

### HIPAA (non-negotiable, phase 0)
- Hosting on a HIPAA-eligible platform **with a signed BAA** (AWS/Azure/GCP —
  current Render free-tier hosting does not qualify).
- BAA-covered AI access (Anthropic offers HIPAA-eligible API arrangements; PHI
  never goes to a non-BAA endpoint). Zero-retention configuration.
- Encryption in transit and at rest, per-user logins, role-based access,
  automatic audit logging of every record view/edit.
- 42 CFR Part 2 handling for substance-use records (separate consent, ROI gating).
- Recording/dictation only with documented client consent.

### Build phases
1. **Phase 1 — Intake & reminders (extend the existing bot):** intake call flow +
   web form, eligibility checks, consent e-sign, scheduling/reminders. Fastest ROI,
   lowest risk.
2. **Phase 2 — Documentation assistant:** dictation → service notes with
   golden-thread checks; then CCA, PCP, and crisis-plan drafting. Clinician
   review/sign workflow with edit tracking.
3. **Phase 3 — Compliance engine:** deadline clocks, authorization/unit tracking,
   nightly self-audit, NC-TOPPS and credential reminders, dashboards.
4. **Phase 4 — Billing:** claim scrubbing, 837 submission via clearinghouse,
   denial parsing and appeal drafting.

### What stays human (by design)
- Diagnosis, medical-necessity determinations, and all signatures.
- Crisis response — the bot recognizes crisis language and immediately routes to
  988/mobile crisis and the on-call clinician; it never "handles" a crisis itself.
- Final content of every document that enters the medical record or a claim.
