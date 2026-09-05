# nc-saiop-psr-licensure-packet — changes

These files are changes to the **`nc-saiop-psr-licensure-packet`** Claude skill.
They live here so they survive; the skill itself is synced from the Claude
account and lives at `~/.claude/skills/synced/<id>/nc-saiop-psr-licensure-packet/`
on whatever machine the skill is running on.

This is **not** a full copy of the skill — only the files that changed, plus the
one that is new.

## What changed

### `_engine/build_certificates.py` — NEW

Generates a print-ready **Certificate of Completion** for every training that
applies to the provider, into `07_Training/Certificates/`:

| Output | What it is |
| --- | --- |
| `NN_<id>.pdf` | one landscape certificate per training |
| `00_ALL_CERTIFICATES.pdf` | all of them in one print job |
| `Express_HTML/NN_<id>.html` | the same design as self-contained HTML |

It reads the same three inputs as `build_training.py` — `agency_config.json`,
`profile.json`, `training_catalog.json` — and shares its `applies()` rule
verbatim, so the certificates and the booklets can never end up covering
different trainings.

ReportLab draws the PDF directly. No LibreOffice pass, no browser, no network,
no Adobe Fonts — so certificates cannot be silently dropped the way a DOCX→PDF
conversion can when a LibreOffice component is missing, and output is identical
on Windows and Linux. Fonts resolve from a candidate list (Liberation → DejaVu →
Georgia/Times) and fall back to ReportLab built-ins of the same metric class.

The HTML twin carries the Adobe Fonts embed (Essonnes Headline + Acumin Pro) the
local PDF cannot use. Push one to Adobe Express when the template needs
restyling; the PDF stays the bulk path.

Design decisions worth keeping:

- **The provider agency is the headline name**, because the certificate lives in
  that agency's personnel file and a DHSR surveyor reads it as that agency's
  training record. The curriculum preparer is a footer line — override it with
  the `CERT_PREPARER` environment variable.
- **Nothing implies state issuance.** The rosette is an ornament with no
  lettering; no NCDHHS or DHSR mark appears anywhere. A certificate that looked
  state-issued would fail the same test the nine external trainings fail.
- **The four fields carry over** from the in-booklet certificate — date
  completed, score/result, instructor, next refresher due — with the rule
  citation printed under the title, straight from the catalogue.

### `_engine/build_provider.py` — two fixes

**1. False `BUILT-PARTIAL` on every single-service packet.** The output plan
listed both the SAIOP and the PSR worksheet unconditionally. Step 6 correctly
builds only the worksheet for a service the provider delivers, so a SAIOP-only
provider always reported a missing PSR worksheet and the whole packet was
downgraded to `BUILT-PARTIAL` — and the reverse for a PSR-only provider. Both
entries are now conditional on `p["services"]`.

**2. Wired in the certificate pack.** `build_certificates.py` runs at step 7b
after `build_training.py`, and step 8 collects `Certificates/` and
`Certificates/Express_HTML/` into `07_Training/`.

### `SKILL.md` — corrected a stale claim

It said *"The builder produces 1 and 2; 3 and 4 are still authored per provider
and are not yet in the engine — say so rather than implying the packet is
complete."* That contradicted the list ten lines below it, which marks both
bundles ✅ built, and it contradicted the code: `build_provider.py` calls
`build_training.py` and `build_disaster.py` and collects both.

The instruction was actively harmful — it told the reader to report that the
training pack does not exist when it does. Replaced with an accurate statement,
keeping the real caution: what a finished build still owes is the
agency-specific blanks, so lead with `BLANKS_TO_COMPLETE.md`.

A `## THE CERTIFICATE PACK` section documents the new script.

## Runtime dependencies

The engine needs these. A bare cloud container has none of them, which is how
the missing-LibreOffice-Writer failure was found:

```bash
pip install python-docx reportlab PyMuPDF openpyxl pypdf pdfminer.six
apt-get install -y libreoffice-writer libreoffice-calc   # Linux only
```

`libreoffice-writer` is the one that bites. Without it `soffice` reports
*"source file could not be loaded"* for every `.docx`, no PDF is produced, the
page index cannot be read, and the DHSR worksheet cannot be filled — which the
skill's own run order calls non-negotiable. `libreoffice-core` alone is not
enough. Certificates are unaffected: ReportLab needs no LibreOffice.

On Windows with Word installed, the DOCX→PDF path is already covered.

## Applying these to the live skill

Copy the three files over the synced skill, keeping paths:

```
_engine/build_certificates.py   ->  <skill>/_engine/build_certificates.py
_engine/build_provider.py       ->  <skill>/_engine/build_provider.py
SKILL.md                        ->  <skill>/SKILL.md
```

`_engine/` is staged wholesale into each per-provider build directory (except a
short exclusion list in `resolve.py`), so a new script needs no registration —
dropping it in is enough.

To edit the skill permanently rather than per-session, make the same changes in
the Claude account the skill syncs from.
