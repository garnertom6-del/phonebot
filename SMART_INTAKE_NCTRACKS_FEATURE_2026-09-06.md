# NCTracks home-screen lookup feature

## Source and scope

The user supplied `NCTracks-Smart-Intake-Skill-2026-09-06.zip` from Downloads. Its SHA-256 is `5E3F039D5D55C948A4251A1FD16CF7FF43691F133EE0BAF3677D3528177CF119`. The ZIP contains two Markdown documents: an execution guide and a proposed integration contract. It contains no running worker or connector. The original ZIP is preserved.

The documents are used as implementation requirements. Their historical login claims and statements about earlier authorization are not treated as current permission to use a mailbox, log in, upload files, or query real clients. This release does not copy those account details into the product.

## Product workflow

Staff open NCTracks lookup from the dashboard or installed-app shortcut. The page requires staff sign-in, respects the selected provider, and accepts a selected intake with separately confirmed first/last names and a date-only DOB. Requests retain their own service period and known MID; compound names are not guessed by splitting a full name.

Provider administrators configure the authorized NPI and a provider-scoped host credential. The server stores its hash. The Windows host connects outbound and processes one leased job at a time. The app does not expose a desktop-control port or store NCID passwords, browser cookies, email codes, or local file paths.

The user subsequently designated **WELLIANCE CARE INC — NPI 1134943608** as the required NCTracks query provider. This is enforced by the configuration API, host contract and runner. It does not reassign intake ownership or change packet/billing provider fields. The installed local skill and a separate revised Downloads ZIP also record this user instruction.

Durable request states distinguish a missing connection, an offline computer, a running lookup, required human action, unresolved identity, no match, failure, cancellation and a locally verified result. Results and observed benefit information stay separate from intake answers. A failed lookup is not an inactive-coverage finding. Requested dates and actual portal dates remain distinguishable.

The host runner uses a supported local agent runtime and the current Edge session. If login, MFA, CAPTCHA, a provider-account correction or local unlock is required, it returns Action required. It does not bypass that step or silently read a mailbox. Only a verified response can be reported as saved on the computer. A local PDF is not automatically uploaded to Smart Intake.

## Connection and evidence boundaries

The home-screen feature, host installation, host connection, portal login, client lookup, PDF verification and application upload are separate milestones. A successful build or heartbeat does not prove a live client lookup. Activation requires the correct provider/NPI and an available authorized host. No real-client verification is inferred from synthetic tests.

NCTracks documents separate provider-portal usage from electronic trading-partner connectivity. The existing optional HTTP/EDI adapters remain separate from this host workflow; they are not enabled by this release. Official connectivity reference: https://www.nctracks.nc.gov/content/public/providers/provider-trading-partners/trading-partner-announcements/Intermittent-Authentication-Error-Guidance.html

## Verification

- Full application `npm run verify` passed, including existing intake, provider isolation, conflict, referral, delivery and additive-schema regression suites.
- The optimized production build (`npm run build`) passed, including TypeScript validation and the new dynamic NCTracks routes.
- `npm run test:nctracks` passed with isolated synthetic databases and a synthetic HTTP host: provider/role checks, NPI enforcement, queue/deduplication, lease expiry, cancellation, stale identity/result rejection, credential revocation, older-record search, local PDF identity/hash checks, actual CLI entrypoints and owned child-process cancellation.
- At 390 × 844, tested the dashboard link, local sign-in return to NCTracks, fixed Welliance NPI, setup-required state, synthetic host availability, saved request, action-required/unknown coverage evidence, retry/cancel, search and retained form fields. No horizontal overflow was found; the rendered evidence/action controls were inspected.
- The real installed Codex CLI reported its required flags and configured CUA connector available via the runner's read-only `--check`. This checks inventory only. No NCTracks inquiry, login, MFA, mailbox access or actual portal PDF export was performed in this feature test.
- The temporary synthetic host credential was revoked and removed. Workstation setup is documented in `smart-intake/scripts/nctracks-host/README.md`. Production host pairing and an authorized client lookup remain separate activation steps.
