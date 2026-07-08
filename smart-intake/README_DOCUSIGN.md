# DocuSign integration (optional)

The app is fully functional WITHOUT DocuSign — clients sign in-app on a canvas
and the signature is placed on every consented form. If Moore Divine Care wants
DocuSign's certified signing ceremony instead, configure these env vars:

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
5. Restart the app.

## How it's wired

- `src/lib/docusign.ts` — `createDocuSignEnvelope()`, `sendCompletedPacketForSignature()`,
  `checkDocuSignStatus()` using the OAuth JWT grant (no SDK dependency).
- Staff → intake page → **Send to DocuSign** generates the completed packet and
  emails it to the client as a DocuSign envelope.
- When unconfigured, the button returns "DocuSign not configured" and the app
  keeps using in-app signature capture. Nothing breaks.
