# Adobe Acrobat / PDF Services (optional)

Smart Intake does **not** install Adobe Acrobat Pro on Render. Desktop Acrobat
is a staff workstation tool. This first slice adds in-app prep guidance and a
**Download for Acrobat** action. Cloud OCR and packet optimization wait for
Adobe PDF Services credentials plus a Codex follow-up.

DocuSign remains the live e-sign path. See `README_DOCUSIGN.md`. Acrobat Sign
is not implemented here.

## Staff workflow (this slice)

1. **Packets** — on the intake case page or PDF preview, choose
   **Download for Acrobat** (final) or **Download draft for Acrobat**. The
   filename stays the existing staff-recognizable
   `{Provider}-Intake-{Client}.pdf` or `-DRAFT.pdf` form.
2. Open the file in **Adobe Acrobat Pro** on a workstation. Use OCR, fix
   AcroForm fields, or redact, then save.
3. Re-upload where the app already accepts files: master packet template,
   case CCA, or NC Tracks upload.
4. **Master packet templates** — prepare fillable AcroForm fields in Acrobat
   Pro *before* mapping and approval.
5. **CCA / NC Tracks scans** — if the file is a photo or image-only PDF, run
   OCR in Acrobat Pro first so MID / PCP / plan extraction has real text.

## Env placeholders (Codex: PDF Services)

Leave these empty in production until Codex implements the API client. The app
starts and runs without them.

| Variable | Purpose |
|---|---|
| `PDF_SERVICES_CLIENT_ID` | Adobe PDF Services API client ID (Adobe Developer Console) |
| `PDF_SERVICES_CLIENT_SECRET` | Adobe PDF Services API client secret |

When both are set, `adobePdfServicesConfigured()` returns true, but OCR and
compress stay **disabled** until Codex turns them on in
`src/lib/adobePdfServices.ts`.

## Files to extend (Codex)

| File | Own next |
|---|---|
| `src/lib/adobePdfServices.ts` | Real PDF Services OCR + compress; keep no-throw when env is empty |
| `src/app/api/intakes/[id]/cca/route.ts` | Already calls `maybeOcrUploadedPdf` before extract |
| `src/app/api/intakes/[id]/nctracks-upload/route.ts` | Same OCR hook |
| `src/lib/generatePacket.ts` | Call `maybeOptimizeGeneratedPacket` after assembly; rehash if bytes change |
| `src/lib/adobeAcrobatPrep.ts` | Staff copy / download hrefs (this slice) |
| `src/lib/docusign.ts` | Leave as the live e-sign path. Optional Acrobat Sign is a later slice. |

Do not require Acrobat Pro on the server. Do not replace DocuSign with Acrobat
Sign in the PDF Services follow-up unless product explicitly switches.
