# Adobe preparation workspace

Open **Adobe document preparation** on the provider dashboard, **Open Adobe preparation** in master packet setup, or `/adobe?providerId=<provider-id>`. Provider administrators prepare blank forms; staff and reviewers can inspect saved files. All reads and writes revalidate provider membership. The existing Document Center, packet filler, approval checks and DocuSign remain in use.

## Available operations

The real Adobe PDF Services adapter supports 24 operations: OCR, compression, linearization, Office/text/image to PDF, PDF to DOCX/XLSX/PPTX/RTF, PNG/JPEG page-image ZIPs, combine, split, rotate, reorder, delete pages from a copy, insert, replace, watermark from another PDF, structured text/table extraction, PDF properties, accessibility check, accessibility auto-tagging, AES-256 password protection and removal with the document password.

Acrobat Pro's complete desktop application is not an embeddable API. Desktop Edit PDF, Prepare Form automatic field detection, advanced redaction, comparison, print production and detailed accessibility repair use the download/edit/upload path. An uploaded edited version records its original source. The preparation workspace offers side-by-side PDF review and field inspection, but does not claim to perform Acrobat desktop comparison or certify an accessible document. Acrobat AI Assistant, desktop plugins, Adobe Sign, electronic seals and Adobe form-data filling are not implemented. The last three would overlap the existing signing/filling workflows.

## Blank forms only

PDF Services uploads documents to Adobe cloud. This workspace has no route that imports client reviews, CCAs, NCTracks replies or final packets. Each uploaded source and each cloud request requires an explicit blank/synthetic confirmation. Digital-signature PDFs are rejected; originals are preserved byte-for-byte. User confirmation is not automated PHI detection. A misleading filename or checkbox cannot establish that a client document is safe to transmit.

Adobe's [current service compliance list](https://www.adobe.com/trust/compliance/compliance-list.html) does not list Acrobat Services (PDF Services API) as HIPAA-ready. Do not enable patient-data processing based merely on an Acrobat Pro subscription. The browser PDF Embed viewer uses its existing separate integration.

## Configuration

Add PDF Services API with an OAuth Server-to-Server credential in Adobe Developer Console. Set `ADOBE_PDF_SERVICES_CLIENT_ID` and `ADOBE_PDF_SERVICES_CLIENT_SECRET` on the server. Keep the separate `ADOBE_PDF_EMBED_CLIENT_ID` for viewing. No secret uses a `NEXT_PUBLIC_` variable. SDK logging is disabled by `config/pdfservices-sdk-log4js-config.json` to avoid logging request details. The Node SDK stays external to Next's server bundle.

US processing uses Adobe's documented `pdf-services.adobe.io` and `pdf-services-ue1.adobe.io` hosts. Polling URLs are validated against those exact HTTPS origins and never sent to the browser. Adobe's official SDK handles asset upload/download and credential exchange. Office/report outputs are attachments, with `nosniff` and a sandbox CSP; returned HTML is never embedded in the application origin.

`ADOBE_PDF_SERVICES_MONTHLY_BUDGET` defaults to 500 estimated transactions across all providers. This is a conservative application budget, not Adobe's billing counter. Failed/uncertain work remains counted. Standard operations estimate one unit per 50 input pages, Extract one per five, auto-tagging ten per page. Unknown Office/text/image input counts are conservatively estimated as 50 pages, but unusually long converted files may use more Adobe transactions. Other applications using this Adobe credential are not counted by Smart Intake. Verify your actual [Adobe API entitlement and pricing](https://developer.adobe.com/document-services/pricing/); an Acrobat Pro subscription is separate.

## Workflow and recovery

1. Save and inspect a blank source (25 MB, up to 100 PDF pages). No Adobe transaction is used for local upload/inspection.
2. Choose source versions in order, select a tool and review its transaction estimate. Passwords exist only in the outgoing operation request; they are not saved or audited.
3. The durable job records SUBMITTING, RUNNING, DONE, NO_CHANGE, FAILED, SUBMISSION_UNKNOWN or EXPIRED. Repeat requests with the same key do not resubmit a paid operation. Status checks use a database lease to save each result once. Closing/reopening the page preserves job history. An ambiguous submission is never automatically retried. A compression job returning `PDF_ALREADY_COMPRESSED` ends as NO_CHANGE with an explanation.
4. Review new files alongside the preserved original. PDF fingerprints are verified at every read. Results are independent versions and never rewrite clinical content, signatures or generated packets.
5. Send a reviewed PDF to the existing mapper. This creates one inactive DRAFT template and preserves the currently approved template. Existing mapping checks, filled preview and master approval remain required. OCR/Acrobat cannot independently approve provider identity, consent wording or answer placement.

Input and output Adobe assets are deleted after success or confirmed failure; interrupted cleanup is visible and can be retried without a new operation. Adobe normally expires temporary assets after 24 hours. A process interrupted before an upload response is recorded may leave an untracked asset until Adobe's expiry. Jobs have no background scheduler: active admin pages check status, or an admin uses Check status / cleanup. Results must be retrieved within Adobe's 24-hour window. No automatic reminders are added.

`AdobePreparationFile` and `AdobePreparationJob` are additive Prisma models. Back up `storage/adobe-preparation` with the database. Admin backup includes file and job metadata but omits remote polling URLs and asset IDs; restore pending jobs from a secure full database backup, not the redacted JSON export. Confirmed provider deletion includes preparation files and cascades metadata; it blocks while a recent cloud job is running or uncertain.

## Verification

- `npx tsx scripts/run-isolated-db-test.ts adobe-preparation`: isolated synthetic tests of access, signed-file rejection, file integrity, options, idempotency, concurrent polling, budgets, password secrecy, ambiguous responses, cleanup, draft handoff and provider deletion.
- `npm run verify` and `npm run build`: full app regression and production build checks.
- `scripts/test-adobe-preparation-live.ts`: opt-in live Adobe test for all tools, guarded to `codex-adobe-browser.db` and the synthetic fixture provider. Uses Adobe transactions. Reads credentials from an explicitly supplied local Developer Console JSON file without printing them. Never run against production or client data.

Official references: [getting started and regional endpoints](https://developer.adobe.com/document-services/docs/overview/pdf-services-api/gettingstarted), [security and temporary storage](https://developer.adobe.com/document-services/docs/overview/security), [Acrobat Prepare Form](https://helpx.adobe.com/acrobat/using/pdf-forms.html).
