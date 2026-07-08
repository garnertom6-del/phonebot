# Coworker handoff — items that need external credentials or business decisions

Everything below requires accounts/credentials we don't hold. **All application
features are already built** — these are configuration tasks.

## 1. Production database (Supabase)
- Create the Supabase project; set `DATABASE_URL` (pooler string).
- Flip `provider = "postgresql"` in `prisma/schema.prisma`; run `npx prisma db push && npm run seed`.
- Change the seeded admin password immediately.

## 2. Production file storage for client uploads
- `src/lib/storage.ts` uses local disk (fine on Render with a persistent disk).
- On Vercel, replace `saveFile`/`readFile` with Supabase Storage calls
  (`@supabase/supabase-js`, a private bucket, service-role key in env).

## 3. Claude API key for CCA auto-fill
- Add `ANTHROPIC_API_KEY` (from platform.claude.com) to the host environment so
  the "Add CCA" button can read assessments. Same key type the phone bot uses.

## 3b. DocuSign (optional)
- Follow README_DOCUSIGN.md; needs the org's DocuSign admin to create the
  integration key, RSA key, and grant consent.

## 4. Email (SendGrid) and SMS (Twilio)
- `SENDGRID_API_KEY` + verified sender for real client-link emails.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` for SMS.
- Until set, sends are logged to the server console (demo mode).

## 5. Hosting + domain
- Choose Vercel or Render (README_DEPLOYMENT.md), set env vars, add
  `intake.mooredivinecare.com` (or similar) and update `APP_BASE_URL`.

## 6. HIPAA / compliance (required before real client PHI)
- Sign BAAs with every vendor touching PHI (hosting, database, email/SMS,
  DocuSign). Note: Vercel/Render free tiers do NOT offer BAAs — a covered
  plan or alternative host is a business decision.
- Access controls: per-staff accounts (add rows to User), password policy,
  consider SSO/2FA.
- Encrypted backups of the database and storage bucket; retention policy.
- Legal/compliance review of the consent texts and e-signature flow
  (NC + federal, 42 CFR Part 2 for substance-abuse records).

## 7. Verify the intake packet with Moore Divine Care staff
- Print `output/sample-completed-angela-demo.pdf` and have staff confirm every
  field lands where they expect. Adjust any placement visually in
  **/admin/pdf-mapping** (no code needed).
