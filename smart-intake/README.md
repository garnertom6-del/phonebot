# Moore Divine Care Smart Intake Automation

A working web application that turns the **actual 43-page Moore Divine Care, Inc.
Client Intake Package PDF** into a guided, secure, voice-enabled client experience.

Staff send a client one secure link → the client answers conversational questions
by **typing or speaking**, agrees to each consent, and **signs once** → the system
fills the real intake packet PDF in its entirety (coordinate-based overlay on all
43 pages, 870 mapped fields), placing the signature only on forms the client
agreed to and leaving staff/clinician lines blank for the office.

## Run it locally

```bash
npm install
npm run db:push
npm run seed
npm run dev
```

Open **http://localhost:3000**

Staff login: **admin@mooredivinecare.local** / **IntakeDemo123!** (local only —
in production the password comes from the `ADMIN_PASSWORD` env var, and five
wrong tries lock login for 15 minutes)

After login you'll see two sample clients (Angela Demo, Jayden Sample) and can
create a new intake. In production, `SEED_DEMO_DATA=false` keeps the sample
clients out of the database.

## Easy Mode (what clients see)

Clients get **Easy Mode** by default: one big question per screen, written at a
5th-grade reading level with a warm tone (built for clients who may be dealing
with substance use or depression). They **tap a big answer button, pick from a
dropdown, or press the microphone and talk**. Skip and Back on every screen,
progress bar, encouragement between sections, plain-language consent summaries
("Read the whole form" is one tap away), and a finger-drawn signature at the
end. Answers auto-save so they can stop and come back. The denser multi-question
wizard is still available at `/intake/<token>?mode=full`. Simple wording lives
in `src/config/easyLanguage.ts`.

## Quick Intake + CCA auto-fill (cut client questions by ~80%)

New intakes default to **Quick Intake**: the client link asks only ~33 essential
screens (identity, contact, emergency contact, the consents, signature — mostly
taps). Everything clinical comes from the clinician's **CCA**: on the intake
page, staff click **📄 Add CCA**, pick the completed Comprehensive Clinical
Assessment (PDF or photo, e.g. from Downloads), and Claude reads the document
and fills the matching intake answers — demographics, presenting problem,
history, diagnoses, medications, allergies, substance use, SNAP, PCP, guardian
info. Works same-day or days later; client answers are never overwritten unless
you check "replace". Requires `ANTHROPIC_API_KEY` in the host environment.
Uncheck "Short client intake" when creating an intake for the full question set.

## The workflow

1. **Staff** logs in → **Create New Intake** → enters the client's basic info
   (name, DOB, MID#, record#, contacts, guardian if applicable).
2. The system creates a **secure random link** (`/intake/<token>`, expires in 7
   days by default, configurable via `CLIENT_LINK_EXPIRY_DAYS`; no PHI in the URL).
3. Staff copies the link or sends it via the email/SMS button (console-logged in
   demo mode; SendGrid/Twilio-ready in production).
4. **Client** opens the link on any device: conversational sections, a 🎤 button
   on long answers (Web Speech API with transcript preview before accepting),
   save-and-continue-later, Fast Intake (required questions first) or Full Intake.
5. Client reviews each consent separately, checks "I agree," and **signs once**
   on a canvas (draw or guardian signs for a minor). Submission is blocked until
   all required items + signature are present.
6. **Staff dashboard** has tabs (Needs action / Waiting on client / Signed /
   Done / Archived), status badges, percent complete, a **missing-field
   checklist**, a one-click **Download backup** (full JSON export), and a real
   Archive. Each intake page shows a numbered workflow guide (Send link →
   Client answers → Add CCA → Review → Generate → Signatures → Send copies)
   with the next step highlighted. Staff review/edit every answer plus
   staff-only sections and capture staff/clinician/witness/medical-director
   signatures. Client-uploaded documents (insurance cards, IDs) have staff-only
   Open buttons; every view is audited.
7. **Generate Completed Packet** fills the real PDF and appends a
   **Certificate of Electronic Signing** (signer identity checked by date of
   birth, recorded time + IP, consents agreed, and a SHA-256 tamper
   fingerprint of the packet pages). Preview, download, print, or send to
   DocuSign — the envelope is tracked, and **Check DocuSign status** pulls the
   certified signed PDF back into the record when the client finishes.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at http://localhost:3000 |
| `npm run db:push` | Create/update the SQLite database |
| `npm run seed` | Seed staff login + two sample clients |
| `npm run generate:samples` | Write `output/sample-completed-angela-demo.pdf` and `output/sample-completed-jayden-sample.pdf` |
| `npm run check:mapping` | Validate the 870-field coordinate map |
| `npm run test` | 11 end-to-end checks (login, tokens, 43-page fill, headers on every page, consent-gated signatures, validation, samples) |

## PDF field mapping

- `src/config/mooreDivinePacketMap.json` — 870 placements generated from the
  actual PDF by `scripts/generate_map.py` (every field anchored to real label
  text; re-run with `python3 scripts/generate_map.py` if the PDF changes).
- `src/config/mooreDivinePacketMap.ts` — typed wrapper.
- `src/config/mooreDivineQuestions.ts` — the client questionnaire (34 sections)
  and staff-only field groups; question keys are the mapping `source` keys.
- `src/lib/fillPdf.ts` / `pdfCoordinates.ts` / `signaturePlacement.ts` — fill engine.
- **/admin/pdf-mapping** — visual mapping editor: preview any page, click to add
  a field, drag/resize, edit properties, test-fill labels, save (stored as DB
  overrides merged over the JSON), export JSON.

The template PDF lives at `MooreDivineCare_Intake_Packet-1.pdf` (project root)
and `public/templates/`. **If it is missing, place the file in the project root
and copy it to `public/templates/` — the app is built around this exact document.**

## Smart auto-fill

One answer fills every place it appears: client name/DOB/MID#/record#/date/location
fill the repeated header on all 43 pages; presenting problem fills pages 4 and 5;
emergency contacts fill pages 7, 10 and 23; PCP info fills pages 7, 10 and 29;
the client name flows into the welcome letter, consents, CCA and Tailored Plan pages.

## Security

- Random 192-bit tokens, 7-day expiry (configurable), no PHI in URLs; expired
  links are auto-renewed when staff hit Remind.
- Client links can only write client-visible questions — staff/clinical fields
  are unreachable from a token. Uploads accept photos/PDFs only.
- Login lockout after 5 wrong tries; signature identity check by date of
  birth; signer IP/device recorded; packet fingerprinted (SHA-256) against
  tampering.
- Answers, signatures and uploads stored server-side; staff routes require login.
- Full audit log: intake created, link opened, section started/completed,
  signature captured, packet submitted, staff reviewed, PDF generated /
  downloaded, documents viewed, backups downloaded, CCA imports, DocuSign
  sent/completed, login lockouts.

> ⚠️ **HIPAA:** this codebase implements technical safeguards, but production
> HIPAA compliance requires BAA-covered hosting and vendors, access controls,
> encrypted backups, and a legal/compliance review. See `COWORKER_HANDOFF.md`.

## Deployment

See `README_DEPLOYMENT.md` (Vercel or Render + Supabase/PostgreSQL, custom
domain, public client links) and `README_DOCUSIGN.md` for optional DocuSign.
