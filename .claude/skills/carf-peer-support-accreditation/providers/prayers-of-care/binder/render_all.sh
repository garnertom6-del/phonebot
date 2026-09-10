#!/bin/sh
# Re-render every Prayers of Care binder document to PDF.
# Run from anywhere:  sh providers/prayers-of-care/binder/render_all.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ENGINE="$HERE/../../../_engine/render_binder_doc.py"
R="python3 $ENGINE"
COMMON_1="Incorporated, CEO-led · 4–10 staff · already serving people"
COMMON_2="No medication management · no faith-based activity"
STATUS="Status: DRAFT — not yet adopted, not yet effective"
PREP="Prepared with Successful Solutions"
NOTDATED="DRAFT — no approval date, no effective date. Do not date until signed."

$R "$HERE/MVV-01_Mission_Vision_Values.md" --id MVV-01 \
  --subtitle "CARF Community Integration (BH) Binder — document MVV-01" \
  --warning "$NOTDATED" \
  --meta "Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "$COMMON_1" --meta "$COMMON_2" --meta "$STATUS" --meta "$PREP"

$R "$HERE/ORG-01_Organizational_Chart.md" --id ORG-01 \
  --subtitle "CARF Community Integration (BH) Binder — document ORG-01" \
  --warning "$NOTDATED" \
  --meta "Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "$COMMON_1" --meta "$COMMON_2" --meta "$STATUS" --meta "$PREP"

$R "$HERE/LEAD-01_Leadership_Policy.md" --id LEAD-01 \
  --subtitle "CARF Community Integration (BH) Binder — document LEAD-01" \
  --warning "$NOTDATED" \
  --meta "Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "$COMMON_1" --meta "$COMMON_2" --meta "$STATUS" --meta "$PREP"

$R "$HERE/JD-01_CEO_Owner.md" --id JD-01 \
  --subtitle "CARF Community Integration (BH) Binder — document JD-01" \
  --warning "$NOTDATED" \
  --meta "Position holder: Nicky Ingram" \
  --meta "$COMMON_1" --meta "$COMMON_2" --meta "$STATUS" --meta "$PREP"

$R "$HERE/JD-02_Peer_Support_Specialist.md" --id JD-02 \
  --subtitle "CARF Community Integration (BH) Binder — document JD-02" \
  --warning "$NOTDATED" \
  --meta "Approver: Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "Community Integration, peer delivery model" \
  --meta "$COMMON_2" --meta "$STATUS" --meta "$PREP"

$R "$HERE/ETH-01_Code_of_Ethics.md" --id ETH-01 \
  --subtitle "CARF Community Integration (BH) Binder — document ETH-01" \
  --warning "DRAFT — do not adopt until the reporting routes in section 'Reporting a concern' are filled in." \
  --meta "Responsible party: Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "Signed by every workforce member — and by the CEO" \
  --meta "At hire, at any revision, and annually" \
  --meta "$STATUS" --meta "$PREP"

$R "$HERE/MTG-01_Leadership_Meeting_Agenda_and_Minutes.md" --id MTG-01 \
  --subtitle "CARF Community Integration (BH) Binder — document MTG-01" \
  --warning "DRAFT — a reusable template. Every date and every score ships blank." \
  --meta "Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "Completed once per leadership meeting — minimum monthly" \
  --meta "Evidence for LEAD-01 sections B, D, E, F and G" \
  --meta "$STATUS" --meta "$PREP"

$R "$HERE/STRAT-01_Strategic_Plan.md" --id STRAT-01 \
  --subtitle "CARF Community Integration (BH) Binder — document STRAT-01" \
  --warning "$NOTDATED" \
  --meta "Nicky Ingram, Chief Executive Officer / Owner" \
  --meta "Three-year plan — inputs in section 3 before goals in section 5" \
  --meta "CARF 1.C Strategic Planning (p.49)" \
  --meta "$STATUS" --meta "$PREP"
