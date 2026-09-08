# DocuSign integration (optional)

The app supports in-app signing without DocuSign. The optional integration sends
an additional client and/or guardian signature envelope and imports its signed
PDF. It currently does not replace the in-app client/guardian signature
requirement. Configure:

| Variable | Where to find it |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign Admin → Apps & Keys → your app's Integration Key |
| `DOCUSIGN_USER_ID` | Apps & Keys page → "User ID" (API Username GUID) |
| `DOCUSIGN_ACCOUNT_ID` | Apps & Keys page → "API Account ID" |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key generated for the app (paste with `\n` for newlines) |
| `DOCUSIGN_BASE_PATH` | `https://demo.docusign.net/restapi` (sandbox) or your production base URI |
| `DOCUSIGN_REDIRECT_URI` | Any registered redirect URI (used for one-time consent) |
| `DOCUSIGN_CONNECT_SECRET` | Connect HMAC key (DocuSign Connect → your configuration → HMAC). Leave empty to keep the webhook disabled. |

Adobe PDF Services and Acrobat prep stay separate. Do not replace this
integration with Acrobat Sign.

## One-time setup

1. Create a developer account at https://developers.docusign.com.
2. Admin → Apps & Keys → Add App & Integration Key.
3. Generate an RSA keypair on the app; store the private key in `DOCUSIGN_PRIVATE_KEY`.
4. Grant one-time consent by visiting (replace values):
  `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=INTEGRATION_KEY&redirect_uri=REDIRECT_URI`
   Use the production authorization host for a production account. Keep all
   configuration values in the deployment secret store, never in client code or
   a test report.
5. Restart the app.

## Recipients (client and guardian)

- Staff → intake page → **Send missing signatures** generates the completed
  packet and emails it as a DocuSign envelope. The provider needs an approved,
  active packet. The case must pass submission, source, consent, review and
  preflight checks and have current staff and any required special-role
  signatures. Only the outstanding client/guardian signature gate is waived for
  sending.
- Recipients follow `preferredIntakeDeliveryRole` / `clientDeliveryContacts`:
  - Preferred client (typical adult): client email only.
  - Preferred guardian (minor / incompetent, or a guardian name when legal
    status is unset): guardian-only envelope.
  - Preferred client plus applicable guardian signature tabs and a guardian on
    file: client then guardian (routing order 1 then 2).
- Guardian name and email come from the client record or answers
  (`guardian_name` / `guardian_email`). Sending fails with a clear error when
  those are missing.
- Staff / QP signatures stay in-app. The send is rejected until the current
  staff signature is captured. Staff is never added as a DocuSign recipient.
- Consent and decline rules that skip signature tabs still apply. A single
  signer receives every remaining client/guardian/auto tab. Two signers split
  those tabs by role.
- In-app SignaturePad remains for desk flows. A completed DocuSign PDF does not
  satisfy the app's client/guardian signature requirement.

## Connect webhook (auto status / import)

Staff can still press **Check DocuSign status** when Connect is unconfigured.

1. In DocuSign Admin → Connect, add a configuration for this app.
2. Listener URL: `https://<your-host>/api/webhooks/docusign`
3. Enable envelope events you care about (at least Completed; Sent, Delivered,
   Declined, and Voided are recorded the same way as a staff status check).
4. Use JSON (or the legacy XML envelope status). Enable HMAC and copy the key
   into `DOCUSIGN_CONNECT_SECRET` on Render. Comma-separated secrets are
   accepted for key rotation.
5. DocuSign signs the raw body with HMAC-SHA256 (`X-DocuSign-Signature-1`).
   Requests without a valid signature are rejected. If the payload includes an
   account ID it must match `DOCUSIGN_ACCOUNT_ID`.

On `completed`, the webhook downloads and validates the PDF, hashes it, and
imports once through the same `recordDocuSignPacket` path as the staff poll:
content-revision binding, single import, and the intake's own provider. Unknown
envelopes are ignored. Repeat notifications are idempotent. A webhook never
imports another provider's envelope.

## Send uncertainty and duplicate prevention

Before calling DocuSign, the app records a `docusign_send_pending` audit with a
unique `transactionId` and the intake content revision, under the intake write
lock. This prevents two staff tabs from sending separate envelopes. A successful
send resolves the audit; a definite rejection permits retry. A timeout, dropped
connection, server error or malformed success response remains pending because
DocuSign may have sent the email. The app will not blindly send it again.

A provider admin (or master) reconciles an unresolved attempt from the case
page. The action looks up the audit's transaction ID in the configured DocuSign
account, attaches a recovered `envelopeId` without sending again, or marks the
attempt failed after the admin confirms DocuSign never created the envelope.
DocuSign documents the
[transaction lookup procedure](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created)
and retains these lookup IDs for seven days. Do not mark an empty first lookup
as failed. Attaching a recovered envelope preserves the original content
revision on `docusign_sent`. Every lookup, attach, and mark-failed action is
audited.

## How the rest is wired

- `src/lib/docusign.ts` — envelope creation, transaction lookup, status, and
  combined PDF download using the OAuth JWT grant (no SDK dependency).
- `src/lib/docuSignRecipients.ts` — client/guardian recipient selection.
- `src/lib/docuSignStatus.ts` — shared status recording and completed import.
- `src/app/api/webhooks/docusign/route.ts` — Connect listener.
- `src/app/api/intakes/[id]/docusign/reconcile/route.ts` — admin reconcile.
- A changed case keeps the imported file as historical evidence and remains in
  review. Cases satisfying every app completion gate receive a protected
  completed-copy link.
- When unconfigured, the button returns "DocuSign not configured" and the app
  keeps using in-app signature capture. Nothing breaks.

## Repeatable integration verification

Run `npx tsx scripts/test-docusign-http-integration.ts`. The script creates an
isolated SQLite database, a synthetic provider/client/packet and an RSA keypair.
All OAuth and envelope requests terminate at a loopback HTTP fixture; any other
network destination is rejected. It verifies:

- Signed JWT grant and actual envelope recipient, PDF, signature/date tabs and
  provider subject; declined consent does not acquire a signature tab.
- Guardian-only and client-then-guardian envelopes; staff still cannot be routed.
- Unauthenticated, read-only and cross-provider requests cannot send or import.
- Repeated/concurrent sends, definite rejection retries, and uncertain results.
- Sent, delivered, declined, voided and completed states and audit records.
- Connect HMAC webhook completed import, unknown envelopes, and staff polling
  when Connect is unconfigured.
- Admin pending reconcile (lookup, attach with original revision, mark failed)
  and still-blocked staff routing.
- Empty status/token responses, HTML/truncated PDFs, signed-PDF hash and single
  import, missing in-app signature blockers, and a changed case during download.
- Completion and protected PDF retrieval for a fully ready synthetic case.

This verifies the application integration, not the live DocuSign account,
recipient mailbox, hosted signing ceremony or certificate. A live end-to-end
test additionally needs an authorized test account and controlled recipient
mailbox, a clearly labeled synthetic packet, and the recipient's own test
signature. Record the envelope ID and verify the actual downloaded PDF in the
app before reporting that external test complete.
