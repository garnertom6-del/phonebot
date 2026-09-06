# Smart Intake workflow release — September 6, 2026

Review base: `054376c376273902fb59cf41ec2c7eca9042259c` in `garnertom6-del/phonebot`.

This release retains the intake bug fixes and replaces the proposed public “Find extra support” page with staff referral tracking and a maintained reference directory. The public finder and its navigation links are omitted.

## Resulting workflows

- **Referral outcomes:** Each intake has provider-scoped support referrals, separate from legacy packet referral rows. States are Suggested, Wants help, Contacted, Applied, Waiting, Approved, Denied, Unavailable and Declined. Staff records explicit client or legal representative permission, the assigned active staff member, next contact, actual contact and separately confirmed assistance. Every change has a dated event and revision. Opening an official source link changes no status. Withdrawal clears future contact and retains prior history.
- **Next required action:** Each dashboard case has one primary action, the blocking reason, responsible role/person and time observed in that step. Client response, CCA, staff review, QP signature, packet setup, regeneration and delivery are distinguished. Unsent or expired intake links are staff work. Existing cases remain unassigned until staff chooses an owner.
- **Plan and benefit directory:** `/provider/directory` requires staff access. Versioned plan labels and official source dates distinguish current and historical information while preserving stored insurance strings, record-number rules and packet mappings. Provider administrators assign a review owner; the owner or administrator records dated reviews. The cadence is 30 days, with weekly HOP checks while restart details remain pending. No provider review is fabricated during migration.
- **Shared-edit protection:** Answers have server-side per-field revisions. Stale writes to the same field reject the entire patch and show the saved and local versions for explicit resolution. Unrelated fields can still save. CCA, eligibility, NCTracks and preflight results are checked against the snapshot taken before slow work. Identity changes reject stale imports. Signing binds to the reviewed content revision and requires visible review of unseen changes.
- **Outcome measures:** Provider totals show submissions, staff-recorded abandonment, seven-day inactivity among active unsubmitted cases, delivery failures, referral contact and confirmed assistance. Inactivity uses client interaction events, not staff edits. Workflow intervals start at first observation; no historical duration is invented. No reminders or external analytics are enabled by these measures.
- **Delivery verification:** Pending/accepted sends are distinguished from confirmed delivery. Late callbacks for an older packet cannot confirm a regenerated packet. A newer accepted retry replaces the prior failure action. Staff can record verified receipt with supporting details bound to the current completed packet.

## Retained bug fixes

- Serialize Easy and Full questionnaire saves, preserve unsaved changes after failures, and flush before navigation/signing/submission.
- Prevent rapid Next taps from skipping sections and only show signatures captured after server success.
- Show a successfully created intake even if optional starter setup fails; prevent duplicate creation taps.
- Keep failed batch rows and successful links; retry only failed rows.
- Treat empty, malformed, incomplete or rejected eligibility responses as needing review, preserving previous coverage answers.
- Synchronize sparse contact and valid DOB changes, clear explicitly removed optional contacts, and preserve home-phone fallback.
- Honor guardian destinations and explicit delivery channels; an unavailable email does not silently become SMS.
- Report recoverable coverage connection errors.
- Keep native referral date entries stable across form edits and validate them before saving.

## Data and release behavior

The SQLite upgrade is additive: answer revisions, optional case ownership/abandonment fields, support referral/event tables, workflow intervals and directory stewardship history. A frozen pre-change schema regression proves stored legacy plans, answer values/timestamps, signature bytes/bindings/dates, clients, intakes and packet referral rows survive the upgrade without `--accept-data-loss`. Existing confirmed master-only provider deletion also handles the new child records and preserves other providers.

Old browser forms without revision tokens fail closed and must reload. Workflow observations run after domain audit events and reconcile when the dashboard refreshes. Timing can therefore lag non-audited changes until that refresh. Recorded source availability is a dated reference, not individual eligibility or guaranteed assistance.

## Verification

Release checks passed: `npm run verify` (87 existing application checks, 9 eligibility checks and all added regression suites), `npm run build`, and staged `git diff --check`. At 390×844 the dashboard, referral editor and staff directory had no horizontal page overflow. The browser test saved permission/ownership/next-contact history, confirmed source-link browsing left status/history unchanged, and reproduced a two-tab conflicting email edit followed by an explicit saved-version resolution.

`npm run verify` runs TypeScript, packet mapping, existing application/eligibility tests, and regression suites for queues, partial batches, directory authorization, contact/delivery behavior, concurrent answer edits, slow source imports, workflow timing/ownership/abandonment, referral authorization/history and schema upgrades. Database suites use isolated synthetic SQLite fixtures; source/provider records and real messaging are not used.

`npm run build` produces the production application. Mobile browser checks use 390×844 for dashboard, referral and directory flows. The public finder is absent. Deployment verification uses the exact merged SHA reported by `/api/health` and live page smoke checks; a merged PR alone is not deployment proof.

The mapping configuration retains 14 pre-existing unmapped-source warnings. Passing software checks does not approve individual clinical documentation or certify payer compliance. Live client messages, payer lookups and clinical uploads are outside these synthetic release checks.
