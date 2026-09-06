# DocuSign integration (optional)

The app supports in-app signing without DocuSign. The optional integration sends
an additional client signature envelope and imports its signed PDF. It currently
does not replace the in-app client/guardian signature requirement. Configure:

| Variable | Where to find it |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign Admin → Apps & Keys → your app's Integration Key |
| `DOCUSIGN_USER_ID` | Apps & Keys page → "User ID" (API Username GUID) |
| `DOCUSIGN_ACCOUNT_ID` | Apps & Keys page → "API Account ID" |
| `DOCUSIGN_PRIVATE_KEY` | RSA private key generated for the app (paste with `\n` for newlines) |
| `DOCUSIGN_BASE_PATH` | `https://demo.docusign.net/restapi` (sandbox) or your production base URI |
| `DOCUSIGN_REDIRECT_URI` | Any registered redirect URI (used for one-time consent) |

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

## How it's wired

- `src/lib/docusign.ts` — envelope creation, status, and combined PDF download
  using the OAuth JWT grant (no SDK dependency).
- Staff → intake page → **Send to DocuSign** generates the completed packet and
  emails it to the client as a DocuSign envelope. The provider needs an approved,
  active packet. The case must pass submission, source, consent, review and
  preflight checks and have current staff and any required special-role
  signatures. Only the outstanding client signature gate is waived for sending.
- Only the client's email receives an envelope. Guardian and staff/QP routing
  are not implemented. A client delivery preference requiring a guardian is
  rejected before DocuSign is contacted.
- Staff explicitly checks envelope status; there is no Connect webhook. Status
  transitions are recorded in provider-scoped audit history. A `completed`
  response downloads and validates a PDF, hashes it, and imports it once, bound
  to the content revision originally sent.
- A changed case keeps the imported file as historical evidence and remains in
  review. A case without a current in-app client/guardian signature remains
  incomplete even if the external envelope is signed. Cases satisfying every
  app completion gate receive a protected completed-copy link.
- When unconfigured, the button returns "DocuSign not configured" and the app
  keeps using in-app signature capture. Nothing breaks.

## Send uncertainty and duplicate prevention

Before calling DocuSign, the app records a `docusign_send_pending` audit with a
unique `transactionId` and the intake content revision, under the intake write
lock. This prevents two staff tabs from sending separate envelopes. A successful
send resolves the audit; a definite rejection permits retry. A timeout, dropped
connection, server error or malformed success response remains pending because
DocuSign may have sent the email. The app will not blindly send it again.

An administrator must reconcile an unresolved attempt against the configured
DocuSign account using the audit's transaction ID. DocuSign documents the
[transaction lookup procedure](https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created)
and retains these lookup IDs for seven days. Do not clear a pending audit merely
because the first lookup is empty. Confirm the final outcome and preserve the
original content revision when recording a recovered envelope. The current UI
has no administrative reconciliation action; unresolved attempts need an
operator-assisted recovery. This limitation is separate from normal status
polling for known envelopes.

## Repeatable integration verification

Run `npx tsx scripts/test-docusign-http-integration.ts`. The script creates an
isolated SQLite database, a synthetic provider/client/packet and an RSA keypair.
All OAuth and envelope requests terminate at a loopback HTTP fixture; any other
network destination is rejected. It verifies:

- Signed JWT grant and actual envelope recipient, PDF, signature/date tabs and
  provider subject; declined consent does not acquire a signature tab.
- Unauthenticated, read-only and cross-provider requests cannot send or import.
- Repeated/concurrent sends, definite rejection retries, and uncertain results.
- Sent, delivered, declined, voided and completed states and audit records.
- Empty status/token responses, HTML/truncated PDFs, signed-PDF hash and single
  import, missing in-app signature blockers, and a changed case during download.
- Completion and protected PDF retrieval for a fully ready synthetic case.

This verifies the application integration, not the live DocuSign account,
recipient mailbox, hosted signing ceremony or certificate. A live end-to-end
test additionally needs an authorized test account and controlled recipient
mailbox, a clearly labeled synthetic packet, and the recipient's own test
signature. Record the envelope ID and verify the actual downloaded PDF in the
app before reporting that external test complete.
