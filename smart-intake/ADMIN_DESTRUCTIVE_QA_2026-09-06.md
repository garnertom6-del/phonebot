# Password reset and permanent deletion verification

Completed on 2026-09-06 using disposable local databases, synthetic users and files. No production account, client, provider, password, NCTracks workstation or external message was changed by these tests.

## Browser test

The real app ran at `http://127.0.0.1:3099` against `prisma/codex-admin-browser.db`. In Edge, the tester signed into the synthetic master dashboard, opened the target provider's administrator-access form, reset its password, signed out, and used the provider sign-in screen. The old password returned **Wrong email or password**; the new password opened **ZZ SYNTHETIC Delete This Provider Intake Dashboard**.

The tester returned to the master dashboard and opened Delete profile for that disposable provider. An incorrect name kept the final action disabled and showed the mismatch explanation. Cancel closed the form and preserved the row. Entering the exact name and clicking **Permanently delete provider** removed the target, showed the success confirmation, and changed the dashboard from two providers to one. No browser error was recorded. The test tab and server were closed afterward.

Post-action database and filesystem readback:

| Check | Result |
| --- | --- |
| Target provider | 0 records |
| Target clients | 0 records |
| Target intakes | 0 records |
| Target login memberships | 0 records |
| Target uploaded test file | Absent |
| Preserved provider | 1 record |
| Preserved provider's client | 1 record |
| Deletion audit | 1 record |

## Actual-route regression tests

`npx tsx scripts/test-admin-destructive-actions.ts` passed. It builds and destroys its own uniquely located SQLite database, blocks all external fetches, and uses synthetic storage files. Coverage includes:

- Provider administrator password reset: unauthenticated/staff rejection, minimum password and paired-field validation, missing provider, master-email protection, another provider's email protection, old-password failure, new-password success and correct provider scope.
- Provider staff password reset: master/shared-provider account protection, minimum password, old/new login and revocation of the previous session.
- Emergency master reset: disabled by default, missing/wrong token rejection, minimum password, actual reset, new master login and revocation of the previous session.
- Session compatibility: valid legacy cookies survive deployment before an account reset; both old and legacy cookies fail after that account's reset. Tampered cookies fail validation.
- Actual permanent provider deletion: unauthenticated/nonmaster/exact-name rejection without partial data or file changes; removal of clients, intakes, memberships, templates/mappings, answers, sections, signatures, generated PDFs, uploads, release consents, packet referrals, emergency contacts, medications, substance-use rows, treatment signature rows, follow-ups, workflow intervals, support referrals/events, directory ownership, NCTracks configuration, host credentials and jobs.
- Another provider's database records and files remain intact. A shared PDF referenced through a different absolute path and an in-storage junction remains available. An out-of-storage junction cannot redirect file deletion. A retry for an already deleted provider returns 404.

## Bugs corrected

1. Password resets previously left issued sessions valid for up to 12 hours. Each reset now increments an account session version checked on authenticated requests. New login cookies include that version; the database addition defaults existing accounts to zero.
2. Provider staff settings could reset a master account's password and a login shared with another provider. Those reset attempts now return a conflict without changing the account.
3. Provider deletion could remove a shared stored template still used by another provider. Cleanup now checks remaining document references using canonical filesystem identity before deleting files.
4. A storage junction could redirect cleanup outside the storage directory. Cleanup now verifies the resolved real path before removal.

TypeScript checking and `git diff --check` passed after these corrections. The two integration suites for administrator actions and DocuSign HTTP workflows were added to the standard `npm test` command.

## Retention boundary

Provider deletion removes login memberships, not the global user identity. A user with no remaining provider membership cannot access the deleted provider. The schema deliberately retains detached audit entries and masked delivery history with the removed provider/intake references set to null. Existing backups and third-party records are outside this app deletion operation. Shared documents still used by another provider are preserved.
