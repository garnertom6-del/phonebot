# NC Tracks automatic lookup

The app now has an **Auto lookup NC Tracks** button on each intake detail page.
For privacy and compliance, the app does not scrape the NC Tracks Provider Portal
or store portal credentials. It calls an approved lookup adapter that your
organization controls.

## Render environment variables

Set these on the `mdc-smart-intake` Render service when your approved NC Tracks
workflow is ready:

```env
NC_TRACKS_LOOKUP_URL=https://your-approved-lookup-service.example/lookup
NC_TRACKS_LOOKUP_SECRET=long-random-shared-secret
```

If `NC_TRACKS_LOOKUP_URL` is blank, the button stays visible but returns a clear
"not connected yet" message. Manual entry still works.

## Request sent by the app

The app sends a staff-authenticated POST request to your adapter:

```json
{
  "intakeId": "intake-id",
  "client": {
    "fullName": "Client Name",
    "dob": "01/01/2010",
    "midNumber": "",
    "recordNumber": "12345",
    "phone": "3365550100"
  },
  "answers": {
    "record_number": "12345",
    "client_phone_cell": "3365550100"
  }
}
```

When `NC_TRACKS_LOOKUP_SECRET` is set, the app includes:

```http
Authorization: Bearer <secret>
```

## Response expected by the app

Return any of these fields as strings. Blank values are ignored.

```json
{
  "mid_number": "123456789A",
  "pcp_name": "Provider Name",
  "pcp_phone": "336-555-0100",
  "pcp_address": "123 Main St, Greensboro, NC",
  "preferred_emergency_facility": "Cone Health Moses Cone Hospital",
  "mco": "Alliance",
  "medicaid_effective_date": "2026-01-01",
  "has_medicaid": "Yes",
  "has_nchc": "No",
  "nchc_policy": ""
}
```

The app saves returned values into the intake, updates the client MID when
present, applies smart defaults, and writes an audit log entry.

## Approved connection options

Use one of these outside-the-app approaches for the adapter:

- NC Tracks Provider Portal lookup performed by an approved staff/RPA workflow
- AVRS/recipient eligibility process converted into the response shape above
- 270/271 eligibility transaction service that your organization is authorized
  to use

Do not place NC Tracks user passwords in this app.
