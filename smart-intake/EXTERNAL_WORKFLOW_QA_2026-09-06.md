# External and destructive workflow QA — 2026-09-06

This extends the full-workflow QA with the explicitly requested NCTracks, DocuSign, physical printing, password-reset and permanent-deletion checks. Real client identifiers and source evidence are kept outside this repository.

| Workflow | Evidence and result |
| --- | --- |
| Password reset | Passed actual browser reset, old-password rejection and new-password login in a disposable local environment. Actual route tests confirm old sessions are revoked and provider staff cannot reset master/shared-provider accounts. |
| Permanent provider deletion | Passed actual browser name confirmation, cancellation and final deletion. Database and file readback confirms target removal, another provider preserved and deletion audited. Shared files, including canonical-path aliases, are retained; storage junction escapes are rejected. |
| NCTracks portal inquiry | A live, authorized name/DOB inquiry returned a matching official reply using the user-designated Welliance NPI 1134943608. The four-page local PDF passed identity/tracking extraction and visual inspection. Portal-expanded dates were preserved separately from requested dates. |
| NCTracks app/workstation | Synthetic end-to-end worker/HTTP/PDF and crash recovery tests passed. A dead worker lock and asynchronous NPI-validation issue were identified and corrected. A matching active intake for the authorized live person was not found in the searched workspaces; a live app job remains dependent on correct record ownership. |
| DocuSign integration | Passed actual application handlers against an isolated HTTP service, JWT request construction, packet/recipient payloads, status transitions, PDF import/hash/idempotence, changed-content protection, concurrent sends and ambiguous failures. These are integration tests, not live DocuSign envelopes. A real send/sign/return still requires a user-supplied controlled recipient email and configured app integration. |
| Physical printing | Exactly one synthetic packet page was submitted to the default Canon C259IF IP with one copy and Simplex verified. Windows reported a failed print job with zero pages printed; the printer's TCP port was unreachable. Paper output is not verified. No retry was submitted. |

## Corrected behavior

- Password resets increment a per-user session version; previous sessions no longer remain authorized after a reset. Existing version-zero sessions survive deployment until that account is reset.
- Provider staff cannot reset a master user or an account shared with another provider.
- Provider deletion preserves files referenced by remaining records, including symlink/junction aliases, and refuses cleanup outside storage.
- DocuSign sends reserve an attempt before contacting the service. Concurrent or uncertain requests cannot silently create duplicate envelopes. A confirmed rejection permits retry; an uncertain result requires administrator reconciliation.
- DocuSign responses and downloaded PDFs are validated. Delayed completion cannot overwrite a newer content revision or staff-review state.
- NCTracks recovers only definitely dead, unchanged worker locks and preserves a replacement owner's lock. A malformed lock, uncertain process status or interrupted transition remains blocked for review.
- The NCTracks runner types the fixed NPI, tabs out and waits for validation before submitting. Account-holder/group names are not treated as organization names. An absent organization label is accepted only with the exact validated NPI and no conflicting provider label; configured names are never reported as observed source evidence.

## Verification and limits

Full `npm run verify`, production `npm run build`, the final worker regression and `git diff --check` passed. The only schema addition is `User.sessionVersion Int @default(0)`; normal schema synchronization applies it without data-loss flags.

See `ADMIN_DESTRUCTIVE_QA_2026-09-06.md` for browser test details and `README_DOCUSIGN.md` for reconciliation requirements. Provider deletion intentionally retains global user identities, detached audit entries and masked delivery history; memberships and provider access are removed. DocuSign evidence remains separate from the in-app signature/completion requirements. No real client's password or provider record was deleted by these tests.

Live deployment, workstation and printer receipts are maintained outside Git with the verification logs. Successful fixture tests must not be presented as completed real-service or physical-paper tests.
