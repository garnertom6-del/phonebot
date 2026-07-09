# Handoff — items that need external credentials or business decisions

Everything below requires accounts/credentials the app can't create for
itself. **All application features are already built** — these are
configuration and paperwork tasks, in priority order.

## 1. Render Blueprint sync (activates data protection) — DO FIRST
- render.yaml now specifies the **Starter plan + a persistent disk** and
  prompts for **ADMIN_PASSWORD** at sync time.
- In dashboard.render.com, approve the pending Blueprint sync: accept the
  Starter plan (~$7/mo) and type a strong ADMIN_PASSWORD.
- After the next deploy the demo password stops working; staff log in with
  the new ADMIN_PASSWORD. `SEED_DEMO_DATA=false` keeps the demo clients
  (Angela Demo / Jayden Sample) out of production.
- Until this sync is approved, the free tier ERASES ALL DATA on every
  restart — do not take real clients before this step.

## 2. BAAs (required before real client PHI)
A BAA is a standard vendor contract promising to protect health data. One
per vendor:
- **DocuSign** — already a paid customer; email the account rep asking for
  a BAA (template wording in the session notes / ask the developer).
- **Anthropic** (AI CCA reading) — request via their sales/trust team.
- **Twilio** (once SMS is enabled) — they sign BAAs on request.
- **Hosting** — Render requires their $499/mo Scale plan for HIPAA
  workspaces; the affordable path is moving the app to Google Cloud or
  Azure (both include a free BAA; ~$25–40/mo total). The code is
  Postgres-ready: flip `provider = "postgresql"` in prisma/schema.prisma,
  set DATABASE_URL, `npx prisma db push && npm run seed`. File storage
  (src/lib/storage.ts) should move to GCS/Azure Blob at the same time.
- SendGrid does NOT sign BAAs — keep emails PHI-free (they already are)
  or switch to a healthcare email vendor later.
- Substance-use records fall under 42 CFR Part 2 (stricter than HIPAA) —
  worth one consult with a compliance professional.

## 3. Claude API key for CCA auto-fill — DONE on Render
- `ANTHROPIC_API_KEY` is set in the Render environment. If the app moves
  hosts, copy it over.

## 4. DocuSign production switch (optional — demo mode works today)
- The org has a paid DocuSign plan. To make envelopes legally binding:
  create the integration key + RSA key in the PRODUCTION account, complete
  DocuSign's one-time Go-Live review (~20 successful demo sends, then
  submit), then set DOCUSIGN_BASE_PATH to the production URL and swap the
  integration credentials. See README_DOCUSIGN.md.
- The app already saves envelope IDs, checks status ("Check DocuSign
  status" button), pulls the signed PDF back into the record, and marks
  the intake COMPLETED when signing finishes.

## 5. Email (SendGrid) and SMS (Twilio)
- `SENDGRID_API_KEY` + `EMAIL_FROM` (a real verified sender — the app
  refuses to send email without EMAIL_FROM).
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` for
  SMS (US numbers need A2P 10DLC registration for reliable delivery).
- Until set, sends are demo-logged (no PHI is written to logs).

## 6. Custom domain
- Add `intake.mooredivinecare.com` (or similar) in the host and set
  `APP_BASE_URL`.

## 7. Ongoing operations
- **Backups**: the dashboard has a Download backup button (full JSON
  export). Download it weekly and keep it somewhere safe/private.
- **Per-staff accounts**: the schema supports multiple users with roles;
  today there is one shared admin login. Adding a user-management screen
  is the next accountability improvement (HIPAA prefers per-person
  logins).
- **Verify the packet with staff**: print output/sample-completed-*.pdf
  and confirm every field lands where staff expect; adjust placements in
  /admin/pdf-mapping (no code needed). The last page of every generated
  packet is the Certificate of Electronic Signing (identity check, IP,
  consents, tamper fingerprint).
