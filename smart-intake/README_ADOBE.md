# Adobe in Smart Intake

Smart Intake includes three connected workflows:

- **Document Center:** staff review copies, Adobe PDF Embed viewing, assigned corrections and version history. See [Document Center](README_DOCUMENT_CENTER.md).
- **Adobe preparation workspace:** 24 real PDF Services operations for blank forms and synthetic samples, provider-scoped jobs and immutable source versions, side-by-side review, and handoff to the existing template mapper. See [configuration, capabilities and testing](README_ADOBE_PREPARATION.md).
- **Acrobat Pro desktop handoff:** download controls and tips on intake, preview, scan upload and packet setup pages. Desktop Edit PDF, Prepare Form, redaction and advanced print tools remain in Acrobat Pro. Re-upload an edited blank form in the preparation workspace to link it to its original.

Set `ADOBE_PDF_EMBED_CLIENT_ID` for the browser viewer. Set the separate server-only `ADOBE_PDF_SERVICES_CLIENT_ID` and `ADOBE_PDF_SERVICES_CLIENT_SECRET` for preparation operations. API use has its own entitlement and transaction limits; an Acrobat Pro subscription does not embed the desktop app or supply unlimited API usage.

`src/lib/adobePreparationTransport.ts` contains the real SDK adapter. `src/lib/adobePdfServices.ts` intentionally keeps the existing CCA/NCTracks upload and completed-packet hooks as byte-preserving functions: they never upload client documents, alter signatures, or recompress a final packet. Those clinical callers remain separate from blank-form preparation even when the Adobe credentials are configured. There is no Adobe Sign integration or second answer-filling engine; DocuSign and the current packet generator remain in use.

Adobe preparation cannot establish provider identity, approve consent language or verify answer placement. The existing mapping, filled-preview and master-approval workflow is still required before a prepared provider template becomes active.
