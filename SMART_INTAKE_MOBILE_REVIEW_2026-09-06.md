# Smart Intake mobile review — September 6, 2026

This release follows the workflow/referral/directory release in PR #68. It keeps the public “Find extra support” entry point omitted and improves the staff referral workflow already added.

## Confirmed fixes and workflow changes

- Cancel delayed question advancement after Back, Skip, a new choice, or unmount. Resume by stable question/section identity instead of an index that shifts when prefilled questions disappear.
- Add Save & exit to both questionnaire modes. Wait for the save queue before showing a saved screen; rejected writes, unresolved conflicts and network failures retain the draft. Save accepted edits before opening rights information, and preserve Full mode on the return link.
- Require a fresh signature after an answer changes. Add accessible question labels and announced validation errors.
- Protect unaccepted speech previews from navigation loss, with explicit acceptance/discard and speech-recognition cleanup.
- Bind single/batch creation to the displayed provider. Keep creation unavailable until that context loads; enforce explicit provider identity and membership on the server.
- Capture native date input events so a manually entered DOB reaches readiness and survives a plan change; show the provider name before creation.
- Generate batch record numbers from each row's plan, preserving official numbers and manual-only plans. Label incomplete rows as started rather than ready.
- Use dedicated completed-copy tokens, with current packet, signature, completion, provider and expiry checks. Concurrent copy-link/delivery requests share the surviving token. Copying a link does not send it or record delivery.
- Mark saved coverage as needing review when client name, DOB or MID changes; refresh the panel on return and show refresh failures. Check returned EDI identity before mapping fields. Ambiguous or mismatched responses preserve packet facts and require review.
- Add a dashboard list of overdue/today referral follow-ups, staff and reassignment filters, and a direct link to the referral. Only scheduled referrals with current permission appear; opening information links does not change referral status.
- Fix iPhone installation-help hydration and accidental sign-in submission. Remove unsupported reassurance in introductory questionnaire copy.

## Verification

Browser testing used a local synthetic database at 390 × 844, with a separate iPhone user-agent check. It covered provider sign-in, single creation, client start, text/dropdown/multi-choice/conditional questions, required-field blocking, save and resume, simulated failed-save/retry, rights navigation, installation help, batch plan-specific numbers and referral creation/permission/date/owner/filter navigation. Dashboard, referral, batch and client pages had no horizontal overflow in these checks.

The save failure was simulated by blocking the local intake API. A saved email was read back from the local database after immediate rights navigation. The referral was a clearly labeled synthetic food-assistance fixture; no real permission was recorded.

Automated verification includes the existing packet/consent/signature/provider suites plus real-database answer conflicts, referral isolation and permissions, schema preservation, explicit create-provider context, coverage identity, completed-copy readiness/concurrency, and progress/save-queue regressions. The mapping checker retains 14 existing unmapped-source warnings and passes; these warnings were not introduced by this release.

No real client records, messages, applications, uploads or eligibility inquiries were used. Browser emulation does not establish physical-device, microphone, SMS transport or production end-to-end clinical readiness. Speech guard behavior is also covered by focused regression tests. Production deployment and health are checked separately after publishing.
