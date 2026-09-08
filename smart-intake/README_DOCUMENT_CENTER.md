# Document Center

Staff can open **Document Center** from a dashboard case, the intake page, or PDF preview. Save a review copy, assign a correction to active staff in the same provider, correct the intake answers, regenerate through the existing workflow, and review the resulting version. Open corrections appear on the provider dashboard with the owner and waiting-since date. Dashboard links open the exact review copy.

## Integration boundary

- Current draft copies call the existing `fillPacket` implementation and approved provider template. There is no second fill engine. Each page is marked as a draft, and field-rendering warnings remain visible.
- Generated packet copies preserve the original PDF bytes, including existing certificates. Review copies and correction notes never change answers, signatures, packet readiness, or delivery status.
- DocuSign remains the existing optional e-signature integration. Client review copies are never sent to Adobe PDF Services. The separate [Adobe preparation workspace](README_ADOBE_PREPARATION.md) processes blank forms and synthetic samples and supports a versioned desktop edit-and-upload workflow.
- Corrections are saved in Smart Intake's side panel, with page, assigned staff, resolution, audit history, and revision checks. Adobe annotation editing and PDF form filling are disabled to avoid unsaved edits.

## Adobe viewer setup

Create a PDF Embed API credential in Adobe Developer Console for the exact application hostname, then set `ADOBE_PDF_EMBED_CLIENT_ID` in the server environment. The ID is public and domain-bound; no Adobe client secret is required. Use a separate localhost credential for local testing. Restart/deploy after configuration changes.

The browser loads Adobe's official viewer SDK. Smart Intake fetches the PDF through a staff-authorized same-origin endpoint and supplies its bytes to the embedded browser viewer. Automatic PDF analytics are disabled and the viewer uses a generic filename. This does not enable a server-side Adobe processing API. The required "Powered by Adobe Document Cloud" attribution is displayed.

Use `/documents/test` while signed in to verify the production domain credential with a generated, non-client sample PDF. If Adobe is unavailable or unconfigured, use the standard viewer. No real client PDF is needed for the setup test.

## Persistence and access

The additive `DocumentReview` and `DocumentCorrection` tables are created by the existing Prisma deployment step. Review PDFs live under `storage/document-reviews/<intakeId>/`; include this storage along with the database in backups. The admin JSON backup includes the review and correction metadata.

Each review has a complete-file SHA-256 checked when served. Original generated files are preserved. Access is provider-scoped, reviewers cannot write, and assignees must be active writable staff in the provider. A stale correction revision returns a visible conflict requiring a reload before retrying. Confirmed provider deletion removes its review files while preserving shared files retained by another provider.

## Verification

- `npm run verify`: typecheck, mapping checks, application regressions, isolated document review tests, full intake lifecycle, destructive-action guards, and existing DocuSign/NCTracks test integrations.
- `npm run build`: production compilation.
- `npx tsx scripts/run-isolated-db-test.ts document-reviews`: focused provider isolation, immutable-copy integrity, draft labeling, conflict, assignee, audit, and deletion checks.
- `scripts/synthetic-adobe-browser-fixture.ts`: optional guarded empty `codex-adobe-browser.db` fixture for a local browser walk-through; never run against production.
