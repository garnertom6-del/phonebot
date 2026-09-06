# Smart Intake full workflow test — September 6, 2026

## Result and scope

The main workflow was exercised in the browser from master setup to provider selection, creation of a new synthetic client, CCA upload, client questionnaire, signatures, staff review, preflight, PDF generation, completion, and the protected client-copy download. The final browser case reached **COMPLETED**. The application generated 401 mapped fields, two required signature roles, and a 44-page PDF including its signing certificate.

Testing used an isolated SQLite database and clearly synthetic records. The only AI adapter was a loopback fixture restricted to one synthetic name, DOB, and PDF hash. Email/SMS credentials and automatic delivery were disabled. A manual delivery attempt correctly reported that email was not configured; no external message was sent. Production inspection began at the master dashboard without changing client records.

This is functional software QA. It is not a clinical approval or a review of every provider's packet mapping. It does not claim every possible button/state combination or live external service was exercised.

## Browser coverage

| Area | Exercised behavior |
| --- | --- |
| Master | Sign-in; all seven summary panels and Close; search/status filters and empty states; all four workflow tabs; create a synthetic provider; mobile More → Login access; open provider workspace. |
| Provider | Explicit provider navigation; totals/status filters; search; completed case and failed-delivery next action; directory ownership and return context. |
| Single creation | Required-field guidance; quick-note extraction; contact fields; insurance; record number; no-send creation; saved provider and local-link feedback. |
| Batch creation | Import two rows; AmeriHealth automatic number; Vaya manual-number requirement; validation; successful creation; Clear and corrected feedback. |
| Client | Start; rights and return; dropdowns, text, numbers, multi-select and yes/no; conditional employment; Save & exit and reload; 49 displayed questions after branch changes; required consent cannot be skipped; full consent text; HIPAA decline and Back readback; optional photo skip. |
| Signing | Typed-signature option; wrong DOB rejection; correct synthetic client signing/submission; required QP selection and separate synthetic staff signing. |
| CCA | Actual file-chooser upload of a synthetic PDF; attachment/readback; matching identity; imported answers and medical-necessity display. Wrong/missing identity and rescan protection covered in isolated handler tests. |
| Review/preflight | Unchanged Save & continue; required next-action update; loopback AI plus rules; optional blank; inline override, short-reason rejection, meaningful reason and audit. |
| Packet | Generate; signature audit; draft viewer Next/Previous/page number/Refresh; final packet extraction and representative page rendering; direct Mark intake completed. |
| Copies/delivery | Independent copy token; copy-link control; completed-copy page; final PDF download; HIPAA decline displayed as decline; unconfigured delivery accurately reported and dashboard routes to Resolve failed delivery. |
| Referrals | Suggested resource; duplicate option disabled; opening source leaves Suggested unchanged; permission/owner/date/outcome controls inspected. Full permission, outcome, conflict and timing transitions covered by isolated tests. |
| Responsive | Master menu reproduction and repair at 390×844; mobile questionnaire before continuation; final completed case and copies checked at 390×844 without horizontal overflow. |

## Reproduced bugs and improvements included

1. Master provider index no longer fails because a previously selected provider was removed; provider-admin scope checks remain enforced.
2. Mobile provider action menus no longer dismiss their own taps because of a hidden desktop copy's ref.
3. Master packet/access deep links open their intended visible section; phone-field focus no longer dereferences a cleared React event.
4. Provider context travels through create-one, create-many, directory, review, plans and preview return links; invalid or unauthorized explicit targets fail closed.
5. Client-detail saves lock the edit session while pending, preventing discarded later edits and double submission. Failed requests preserve the draft.
6. Dashboard action and clipboard failures now have visible recovery guidance; clipboard success is not claimed after rejection.
7. Conditional questionnaire navigation tracks question identity instead of a shifting index. Work phone follows its employment trigger and details.
8. Batch record-number feedback clears when rows change, are corrected, reset, or successfully created.
9. CCA upload/rescan rejects missing or mismatched source identity before any answer/document mutation. Existing stored identity mismatches also block generation.
10. Preflight binds its review to the content revision and source snapshot, rejecting edits that occur while AI is running.
11. Dashboard readiness uses the same substantive gates as final completion; workflow observations recompute under lock so stale GETs cannot reverse newer timing intervals.
12. Required witness/medical-director slots are enforced. Signature-only plan gates route to signing rather than an endless staff-review step.
13. Completed-copy delivery uses the current packet/readiness checks before attempting a send.
14. DocuSign import reserves a unique packet version and records the revision sent, avoiding version collisions and false freshness. The supported recipient lane and remaining in-app signature requirement are stated accurately.
15. Explicit staff review persists an event tied to the content revision the reviewer actually saw. The revision check, answer save and review audit share a transaction. Changes in another tab require a fresh review, ordinary answer saves do not certify review, and an unchanged completed case retains its completion and copy access.
16. Preflight override uses an accessible inline reason form instead of an unsupported browser prompt; errors retain the draft, pending saves are guarded, and successful overrides refresh the next action's readiness.
17. A direct Mark intake completed action appears on a ready case and rechecks server readiness through the existing completion endpoint.
18. Required-signature hints ignore optional slots, and recorded HIPAA decline is shown as a recorded consent response rather than missing or agreed.
19. Master provider deletion uses an accessible exact-name confirmation form instead of an unsupported browser prompt. Open, invalid-name rejection, Cancel, and restored focus were checked without submitting a deletion.

## Verification

The final `npm run verify` passed, including TypeScript, mapping checks, all 87 application checks, all 9 eligibility checks, and every existing and newly added regression script. The final `npm run build` also passed. The deployment receipt records the deployed SHA and live smoke checks.

New/expanded regression coverage includes delayed saves, explicit provider context across cookie changes, clipboard failure, conditional question ordering, CCA identity, preflight concurrency, workflow observation races, extra signature roles, DocuSign version/revision import, copy readiness, and a full synthetic handler lifecycle. The latter verifies material edits invalidate signatures and the generated packet, revoke the old copy download, and prevent premature recompletion. No external services are needed.

Generated browser-test packet: 44 pages, 1,312,214 bytes. SHA-256: `e190a84aa2249c8da496803b07146ec3c84e27ea2b0beb38074290c27438c057`. Text contains the synthetic client name on all 44 pages. Representative identity, CCA-signature and signing-certificate pages rendered and inspected. Optional/inapplicable signature lines remain blank.

## Deliberate limits and remaining work

- Real SMS/email delivery, live NCTracks inquiries, DocuSign envelopes, camera/microphone permissions, physical printing, password resets, permanent deletion and production packet activation were not performed.
- DocuSign PDFs can be imported and archived, but external signing evidence is not yet accepted as the app's required client signature. The UI now explains the secure in-app signing requirement before sending.
- Provider-specific mappings, optional attachments and PCP/crisis documents require their own evidence and review. The completed synthetic case verifies application gates, not the substantive readiness of a real client record.
