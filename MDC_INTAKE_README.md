# Moore Divine Care — Automated Client Intake Packet

Send a client **one link**. They answer guided questions by **speaking or typing**,
sign **once** on screen, and the entire Client Intake Packet is generated with every
client field, consent, initial box, signature line and date filled in automatically.
Staff lines (QP, clinician, witness) stay blank for the office.

Paper packet: ~60–90 minutes and ~15 separate signatures.
This link: **~15 minutes and one signature.**

## How to use it (day to day)

1. Text or email the client the link: `https://YOUR-APP.onrender.com/mdc`
2. Client answers on their phone — every text box has a 🎤 mic button so they can
   just talk instead of typing. Sections that don't apply are skipped automatically
   (no guardian questions for adults, no substance table if the answer is No, etc.).
3. Client reviews each consent (tap **Read** for the full legal text), checks
   "I agree", draws (or types) their signature once, and submits.
4. The completed packet appears instantly:
   - Client gets a link to view/save their copy.
   - Staff see all completed intakes at `/mdc/admin?key=YOUR_ADMIN_KEY`
     (each row links to the filled packet — use **Print / Save as PDF** for the chart).

## The two delivery options

**Option 1 — Built-in e-signature (works out of the box).**
The client signs on screen in the wizard. The signature is stamped on all ~18
signature lines and their initials on all 11 initial boxes, each with the date.
A signed Electronic Signature Certificate page (timestamp, IP, device, consent
record) is appended to the packet as the audit trail.

**Option 2 — DocuSign (certified signature ceremony).**
After a client submits, staff can push the completed packet through DocuSign:

```
POST /mdc/docusign/<intake-id>?key=YOUR_ADMIN_KEY
```

The packet is sent to the client's email as a DocuSign envelope. Anchor tabs are
embedded at every signature/initial/date spot, so DocuSign guides the client to
tap each highlighted spot; DocuSign then produces its certified, court-ready
Certificate of Completion. Configure these environment variables in Render:

| Variable | Example |
|---|---|
| `DOCUSIGN_BASE_URI` | `https://na4.docusign.net/restapi` (or `https://demo.docusign.net/restapi` for sandbox) |
| `DOCUSIGN_ACCOUNT_ID` | your API Account ID (GUID from DocuSign → Settings → Apps & Keys) |
| `DOCUSIGN_ACCESS_TOKEN` | an OAuth access token for your DocuSign user |
| `INTAKE_ADMIN_KEY` | any secret you choose — protects `/mdc/admin` and the DocuSign send |

## What gets filled automatically

- Header on every page (Client Name, DOB, MID#, Date of Intake, Location) — asked once.
- Client Face Sheet (demographics, address, phones, living arrangement, employment,
  education, funding/income sources, veteran status, emails).
- Client Screening Form (referral, MCO/LME, diagnosis, therapist, Medicaid/NCHC).
- Presenting Problem + Admission Assessment (client-provided portions: mental
  health, medical, legal, substance use, household).
- Client Emergency Information (physical description, allergies, meds, PCP,
  preferred ER, emergency contacts) — signed.
- All consents: Provider Choice, Orientation, Rights & Responsibilities, Consent
  for Treatment (6 initialed items), 24-Hour On-Call, Bill of Rights, Transport,
  Emergency Care, Emergency Interventions, HIPAA Notice, Confidentiality
  Exceptions, Treatment Plan Participation/Receipt, Tailored Plan permission —
  each signed and dated.
- HIV/AIDS & Substance Abuse disclosure consents (per recipient, with initialed
  record categories).
- PCP Collaboration Form (pre-filled with the client's doctor for staff to send).
- Welcome Letter (client name filled in), Referrals page, CCA and Treatment Plan
  signature pages.

Anything clinical (severity of need, diagnosis coding, QP determinations) is left
for staff, clearly marked.

## Notes

- Completed intakes are stored as JSON in `data/mdc_intakes/`. Render's free-tier
  disk is ephemeral — **print/save the packet PDF (or send via DocuSign) when the
  intake arrives**, or attach a Render persistent disk to keep the JSON records.
- This intake collects health information. Keep `INTAKE_ADMIN_KEY` secret, share
  packet links only with the client, and check your Render plan/BAA posture for
  HIPAA compliance before wide use.
