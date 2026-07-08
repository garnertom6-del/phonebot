#!/usr/bin/env python3
"""Generate src/config/mooreDivinePacketMap.json from the actual packet PDF.

Every field is anchored to real label text extracted with pdfplumber, so the
coordinates match the true layout of MooreDivineCare_Intake_Packet-1.pdf.
Coordinates are emitted in pdf-lib space (origin bottom-left, points).
Staff can fine-tune any placement later in the /admin/pdf-mapping screen
(overrides are stored in the database and merged over this file).

Re-run after replacing the PDF:  python3 scripts/generate_map.py
"""
import json
import os

import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "MooreDivineCare_Intake_Packet-1.pdf")
OUT = os.path.join(ROOT, "src", "config", "mooreDivinePacketMap.json")

RIGHT = 560
LEFT = 40


def norm(tok):
    t = tok.replace("_", "").strip(".,:;()“”\"'#?!□●→▸⮚ ")
    return t.replace("’", "'").replace("‘", "'").lower()


class Page:
    def __init__(self, plumber_page, number):
        self.number = number
        self.h = float(plumber_page.height)
        self.w = float(plumber_page.width)
        self.words = plumber_page.extract_words()
        for w in self.words:
            w["n"] = norm(w["text"])

    def find(self, phrase, occ=0, top_min=None, top_max=None):
        toks = [t for t in (norm(x) for x in phrase.split()) if t]
        hits, n = [], len(self.words)
        for i in range(n):
            w0 = self.words[i]
            if w0["n"] == "":  # never start a match on an underscore-only token
                continue
            if top_min is not None and w0["top"] < top_min:
                continue
            if top_max is not None and w0["top"] > top_max:
                continue
            j, k = i, 0
            while j < n and k < len(toks):
                wn = self.words[j]["n"]
                if wn == "":
                    j += 1
                    continue
                if wn == toks[k] or (k == len(toks) - 1 and len(toks[k]) >= 2
                                     and wn.startswith(toks[k])):
                    j += 1
                    k += 1
                else:
                    break
            if k == len(toks):
                seq = self.words[i:j]
                hits.append({"x0": min(s["x0"] for s in seq), "x1": max(s["x1"] for s in seq),
                             "top": min(s["top"] for s in seq), "bottom": max(s["bottom"] for s in seq),
                             "first": seq[0], "last": seq[-1]})
        return hits[occ] if occ < len(hits) else None

    def find_raw(self, substr, occ=0, top_min=None, top_max=None):
        hits = []
        for w in self.words:
            if top_min is not None and w["top"] < top_min:
                continue
            if top_max is not None and w["top"] > top_max:
                continue
            if substr in w["text"]:
                hits.append(w)
        return hits[occ] if occ < len(hits) else None

    def next_blank(self, bbox, tol=4):
        for w in self.words:
            if abs(w["top"] - bbox["top"]) <= tol and w["x0"] >= bbox["x1"] - 2 and "___" in w["text"]:
                return w
        return None

    def prev_blank(self, bbox, tol=4):
        best = None
        for w in self.words:
            if abs(w["top"] - bbox["top"]) <= tol and w["x1"] <= bbox["x0"] + 2 and "___" in w["text"]:
                if best is None or w["x0"] > best["x0"]:
                    best = w
        return best


MISSES, ENTRIES = [], []


def emit(pg_obj, key, source, ftype, x, y_top, w, h, **kw):
    row = {
        "page": pg_obj.number, "fieldKey": key, "source": source, "type": ftype,
        "x": round(x, 1), "y": round(pg_obj.h - y_top - h, 1),
        "width": round(w, 1), "height": round(h, 1),
        "fontSize": kw.get("fs", 9), "lines": kw.get("lines", 1),
        "lineHeight": kw.get("lineHeight", 11.6),
        "required": kw.get("required", False), "role": kw.get("role", "client"),
        "consentKey": kw.get("consent"), "notes": kw.get("notes", ""),
    }
    # long-answer flow: an answer wrapped to `flowLines` total lines can span
    # several placements; each renders its slice starting at `startLine`
    if kw.get("flowLines"):
        row["flowLines"] = kw["flowLines"]
        row["startLine"] = kw.get("startLine", 0)
    ENTRIES.append(row)


def miss(pg, key, why):
    MISSES.append("p%02d %-34s %s" % (pg, key, why))


def frac_x(word, part=None):
    """x position just after the visible-text part of a token like 'Name_____'."""
    raw = word["text"]
    if part is None:
        part = raw.rstrip("_")
    idx = raw.find(part)
    if idx < 0:
        return word["x0"]
    f = (idx + len(part)) / max(len(raw), 1)
    return word["x0"] + (word["x1"] - word["x0"]) * f + 2


def field(pg, key, source, anchor, mode="after", occ=0, ftype="text", width=None,
          dx=4, dy=0, h=11, fs=9, lines=1, required=False, role="client",
          consent=None, top_min=None, top_max=None, notes="", **extra):
    p = PAGES[pg - 1]
    if mode in ("raw", "on_raw"):
        w = p.find_raw(anchor, occ=occ, top_min=top_min, top_max=top_max)
        if not w:
            return miss(pg, key, "raw token not found: %r" % anchor)
        if mode == "raw":  # initials/X drawn on the leading underscores
            emit(p, key, source, ftype if ftype != "text" else "checkbox",
                 w["x0"] + dx, w["top"] + dy, 12, 10, fs=9, role=role, consent=consent, notes=notes)
        else:              # text written on the underscore run
            emit(p, key, source, ftype, w["x0"] + 2 + dx, w["top"] + dy,
                 width or (w["x1"] - w["x0"] - 4), h, fs=fs, lines=lines,
                 required=required, role=role, consent=consent, notes=notes, **extra)
        return
    if mode == "compound":
        # value goes right after the `notes` substring inside a raw token
        part = notes or anchor
        w = p.find_raw(part, occ=occ, top_min=top_min, top_max=top_max)
        if not w:
            return miss(pg, key, "compound token not found: %r" % part)
        x = frac_x(w, part)
        emit(p, key, source, ftype, x, w["top"] + dy, width or max(RIGHT - x, 30), h,
             fs=fs, lines=lines, required=required, role=role, consent=consent, **extra)
        return
    bb = p.find(anchor, occ=occ, top_min=top_min, top_max=top_max)
    if not bb:
        return miss(pg, key, "anchor not found: %r" % anchor)
    if mode == "after":
        last = bb["last"]
        x = frac_x(last) if last["text"].rstrip("_") != last["text"] else bb["x1"] + dx
        w = width or max(RIGHT - x, 30)
        emit(p, key, source, ftype, x, bb["top"] + dy, w, h, fs=fs, lines=lines,
             required=required, role=role, consent=consent, notes=notes, **extra)
    elif mode == "blank_after":
        blank = p.next_blank(bb)
        if blank is None:
            last = bb["last"]
            if last["text"].rstrip("_") != last["text"]:
                x = frac_x(last)
                emit(p, key, source, ftype, x, bb["top"] + dy, width or max(RIGHT - x, 30),
                     h, fs=fs, lines=lines, required=required, role=role, consent=consent)
                return
            return miss(pg, key, "no blank after %r" % anchor)
        x = blank["x0"] + 3 + (frac_x(blank) - blank["x0"] - 2 if blank["text"].lstrip("_") != blank["text"] and not blank["text"].startswith("_") else 0)
        if not blank["text"].startswith("_"):
            x = frac_x(blank)
        w = width or max(blank["x1"] - x - 2, 30)
        emit(p, key, source, ftype, x, bb["top"] + dy, w, h, fs=fs, lines=lines,
             required=required, role=role, consent=consent, notes=notes)
    elif mode == "blank_before":
        blank = p.prev_blank(bb)
        if not blank:
            return miss(pg, key, "no blank before %r" % anchor)
        emit(p, key, source, ftype, blank["x0"] + 3, bb["top"] + dy,
             width or max(blank["x1"] - blank["x0"] - 6, 30), h, fs=fs, lines=lines,
             required=required, role=role, consent=consent)
    elif mode == "below":
        emit(p, key, source, ftype, LEFT, bb["bottom"] + 2 + dy, width or (RIGHT - LEFT),
             h * lines, fs=fs, lines=lines, lineHeight=11.6, required=required, role=role,
             consent=consent, notes=notes, **extra)
    elif mode == "check":
        emit(p, key, source, "checkbox", bb["x0"] - 12 + dx, bb["top"] + dy, 10, 10,
             fs=10, required=required, role=role, consent=consent, notes=notes)
    elif mode == "check_on_blank":
        emit(p, key, source, "checkbox", bb["first"]["x0"] + 1 + dx, bb["top"] + dy, 10, 10,
             fs=10, required=required, role=role, consent=consent, notes=notes)
    else:
        raise ValueError(mode)


def sig_pair(pg, caption, occ, key, consent, role="client", source="signature",
             sig_w=170, date_x_min=300, top_min=None):
    """Signature image on the blank line paired with a caption, + date text.

    Some pages draw the underscore line above the caption, some below - find
    the nearest underscore-run within 20pt vertically and sign on it.
    """
    p = PAGES[pg - 1]
    bb = p.find(caption, occ=occ, top_min=top_min)
    if not bb:
        return miss(pg, key, "caption not found: %r" % caption)
    # a signature line always sits ABOVE its caption in this packet; a line
    # below a caption belongs to the next signer's caption
    line = None
    for w in p.words:
        if "___" in w["text"] and w["x0"] < bb["x0"] + 30 and 2 < bb["top"] - w["top"] <= 30:
            if line is None or w["top"] > line["top"]:
                line = w
    # the underscore STROKE sits at the bottom of its glyph box - anchor there
    line_ink = line["bottom"] - 1 if line else None
    sig_top = (line_ink - 24) if line_ink else (bb["top"] - 26)
    emit(p, key, source, "signature", bb["x0"] + 6, sig_top, sig_w, 23,
         role=role, consent=consent, notes="signature for caption: " + caption)
    for w in p.words:
        if abs(w["top"] - bb["top"]) <= 4 and w["x0"] >= date_x_min and w["n"].startswith("date"):
            date_top = (line_ink - 12) if line_ink else (bb["top"] - 14)
            emit(p, key + "_date", "sign_date", "text", w["x0"], date_top, 85, 11,
                 role=role, consent=consent)
            return
    miss(pg, key + "_date", "date word not on caption line")


def phone_line(pg, occ_line, home_key, work_key, cell_key, src_prefix):
    """Lines shaped like: Home Telephone #_____Work #_____ Cell phone #_____"""
    if src_prefix == "client_":
        sources = ("client_phone_home", "client_phone_work", "client_phone_cell")
    else:
        sources = (src_prefix + "home_phone", src_prefix + "work_phone", src_prefix + "cell_phone")
    p = PAGES[pg - 1]
    tok = p.find_raw("Work", occ=occ_line)
    if not tok or "#" not in tok["text"]:
        # 'Work' embedded in '#____Work' token
        tok = None
        cands = [w for w in p.words if "Work" in w["text"] and "#" in w["text"]]
        if occ_line < len(cands):
            tok = cands[occ_line]
    if not tok:
        return miss(pg, home_key, "phone line not found")
    top = tok["top"]
    hx = frac_x(tok, "#")
    emit(p, home_key, sources[0], "text", hx, top, tok["x1"] - hx - 24, 11)
    rest = sorted([w for w in p.words if abs(w["top"] - top) <= 4 and w["x0"] > tok["x1"] - 4
                   and w["text"].startswith("#")], key=lambda w: w["x0"])
    if rest:
        emit(p, work_key, sources[1], "text", rest[0]["x0"] + 6, top,
             rest[0]["x1"] - rest[0]["x0"] - 8, 11)
    if len(rest) > 1:
        emit(p, cell_key, sources[2], "text", rest[-1]["x0"] + 6, top,
             rest[-1]["x1"] - rest[-1]["x0"] - 8, 11)
    else:
        miss(pg, cell_key, "cell blank not found on phone line")


with pdfplumber.open(PDF) as pdf:
    PAGES = []
    for i, pg in enumerate(pdf.pages):
        page = Page(pg, i + 1)
        # header table geometry: 7 vertical borders forming 6 cells; the value
        # row sits between the middle (69.4) and bottom (83.6) horizontal rules
        page.hdr_cols = sorted({round(l["x0"], 1) for l in pg.lines
                                if l["top"] < 95 and abs(l["top"] - l["bottom"]) > 5})
        hrows = sorted({round(l["top"], 1) for l in pg.lines
                        if l["top"] < 95 and abs(l["x1"] - l["x0"]) > 100})
        page.hdr_value_top = hrows[1] + 2 if len(hrows) >= 3 else 71.4
        PAGES.append(page)

# ── repeated header on all 43 pages: values go IN the box under each label ──
HDR_COLS = [
    ("hdr_client_name", "client_full_name"), ("hdr_dob", "dob"),
    ("hdr_mid", "mid_number"), ("hdr_record", "record_number"),
    ("hdr_intake_date", "intake_date"), ("hdr_location", "location"),
]
for p in PAGES:
    cols = getattr(p, "hdr_cols", [])
    if len(cols) >= 7:
        for ci, (key, source) in enumerate(HDR_COLS):
            x0, x1 = cols[ci], cols[ci + 1]
            emit(p, "%s_p%d" % (key, p.number), source, "text",
                 x0 + 4, p.hdr_value_top, x1 - x0 - 8, 11, fs=8.5, role="auto",
                 notes="value cell of repeated page-header table")
    else:
        # fallback: next to the label if a page ever lacks the table borders
        for key, source in HDR_COLS:
            label = {"hdr_client_name": "Client Name", "hdr_dob": "DOB", "hdr_mid": "MID#",
                     "hdr_record": "Record#", "hdr_intake_date": "Date of Intake",
                     "hdr_location": "Location"}[key]
            bb = p.find(label, top_max=75)
            if bb:
                emit(p, "%s_p%d" % (key, p.number), source, "text", bb["x1"] + 3,
                     bb["top"], 60, 10, fs=7, role="auto", notes="repeated page header")
            else:
                miss(p.number, key, "header label missing")

# ── page 1: staff document checklist ────────────────────────────────────────
for key, anchor in [
        ("chk_applicant_forms", "__Complete"), ("chk_social_history", "__Social"),
        ("chk_psych_eval", "__Psychological"), ("chk_last_placement", "__Pertinent"),
        ("chk_court_history", "__History"), ("chk_birth_cert", "__Copy of Birth"),
        ("chk_insurance_card", "__Copy Health"), ("chk_court_order", "__Copy of court"),
        ("chk_ss_card", "__Copy of Social"), ("chk_iep", "__Current"),
        ("chk_medications", "__Medications"), ("chk_pcp_plan", "__Copy of the current"),
        ("chk_immunizations", "__Copy of immunization"), ("chk_standing_orders", "__Signed")]:
    field(1, key, "staff_" + key, anchor.split()[0].replace("__", "__"), mode="raw",
          occ=0 if anchor.count(" ") == 0 else 0, role="staff",
          top_min=380) if False else None
# simpler: anchor by unique phrases
P1_ITEMS = [
    ("chk_applicant_forms", "Complete applicant forms"), ("chk_social_history", "Social History"),
    ("chk_psych_eval", "Psychological evaluation within"), ("chk_last_placement", "Pertinent records of the last"),
    ("chk_court_history", "History of court involvement"), ("chk_birth_cert", "Copy of Birth Certificate"),
    ("chk_insurance_card", "Copy Health Insurance Card"), ("chk_court_order", "Copy of court order"),
    ("chk_ss_card", "Copy of Social Security Card"), ("chk_iep", "Current or last IEP"),
    ("chk_medications", "Medications and Medication education"), ("chk_pcp_plan", "Copy of the current Person-Centered"),
    ("chk_immunizations", "Copy of immunization records"), ("chk_standing_orders", "Signed Physician Standing Orders")]
for key, anchor in P1_ITEMS:
    field(1, key, "staff_" + key, anchor, mode="check", dx=2, role="staff", top_min=380)

# ── page 2: client face sheet ───────────────────────────────────────────────
for opt in ["Female", "Male", "Transgender", "Other"]:
    field(2, "gender_" + norm(opt), "gender=" + opt, "___" + opt, mode="check_on_blank",
          top_min=143, top_max=156, required=(opt == "Female"))
for anchor, val in [("___American Indian", "American Indian or Alaska Native"), ("___Asian", "Asian"),
                    ("___Black or African American", "Black or African American"),
                    ("___Caucasian or White", "Caucasian or White"), ("___Multiracial", "Multiracial"),
                    ("___Native American", "Native American"), ("___Native Hawaiian", "Native Hawaiian or Pacific Islander")]:
    field(2, "race_" + norm(val).replace(" ", "_"), "race=" + val, anchor, mode="check_on_blank",
          top_min=165, top_max=225)
for anchor, val in [("Hispanic/White", "Hispanic/White"), ("___Non-Hispanic/White", "Non-Hispanic/White"),
                    ("___Latino", "Latino"), ("Hispanic/Black", "Hispanic/Black"),
                    ("___Non-Hispanic/Black", "Non-Hispanic/Black")]:
    field(2, "eth_" + norm(val).replace("/", "_").replace("-", "_"), "ethnicity=" + val, anchor,
          mode="check" if anchor.startswith("His") else "check_on_blank", top_min=235, top_max=272)
for opt in ["Single", "Married", "Separated", "Widowed"]:
    field(2, "marital_" + norm(opt), "marital_status=" + opt, opt, mode="check", top_min=282, top_max=296)
field(2, "address_street", "address_street", "Address", mode="compound", notes="Address",
      occ=0, top_min=305, top_max=320, width=210, required=True)
field(2, "address_city", "address_city", "City", mode="compound", notes="City", occ=0,
      top_min=305, top_max=320, width=140)
field(2, "address_state", "address_state", "State", mode="compound", notes="State", occ=0,
      top_min=305, top_max=320, width=26)
field(2, "phone_home", "client_phone_home", "Cell", mode="compound", notes="#", occ=0,
      top_min=322, top_max=336, width=180)
p2 = PAGES[1]
w = p2.find_raw("#", occ=1, top_min=322, top_max=336)
if w and w["text"].startswith("#"):
    emit(p2, "phone_cell", "client_phone_cell", "text", w["x0"] + 8, w["top"], 170, 11, required=True)
else:
    miss(2, "phone_cell", "cell blank not found")
LIV = [("Adult with Spouse", "adult_spouse"), ("Adult with Relative", "adult_relative"),
       ("Adult Alone", "adult_alone"), ("Homeless", "homeless"), ("Residential", "residential"),
       ("Living in hospital/institution", "hospital"), ("Child with Parent", "child_parent"),
       ("Child with other relative", "child_relative"), ("Child with Non-relative", "child_nonrel")]
for label, k in LIV:
    field(2, "living_" + k, "living_arrangement=" + label, label, mode="check", top_min=340, top_max=400)
for opt in ["Not in Labor Force", "Unemployed", "Disabled", "Employed"]:
    field(2, "emp_" + norm(opt).replace(" ", "_"), "employment_status=" + opt, opt,
          mode="check", top_min=410, top_max=424)
field(2, "occupation", "occupation", "Client Occupation", mode="after", width=200)
field(2, "employer_name", "employer_name", "Employer Name", mode="after", width=200)
field(2, "employer_addr", "employer_address", "Employer Add", mode="after", width=200)
field(2, "employer_phone", "employer_phone", "Employer Phone", mode="blank_after", width=180)
for opt, k in [("Grade/Elementary", "grade"), ("High School/GED", "hs"), ("College", "college"),
               ("Graduate", "grad"), ("Post Graduate", "postgrad")]:
    field(2, "edu_" + k, "education=" + opt, opt, mode="check", top_min=526, top_max=540)
field(2, "funding_medicaid", "has_medicaid=Yes", "Medicaid Effective", mode="check", top_min=548, top_max=562)
field(2, "medicaid_eff", "medicaid_effective_date", "Medicaid Effective Date", mode="after", width=80)
field(2, "funding_medicare", "has_medicare=Yes", "Medicare Effective", mode="check", top_min=548, top_max=562)
field(2, "medicare_eff", "medicare_effective_date", "Medicare Effective Date", mode="after", width=80)
field(2, "funding_other", "funding_other", "Other", mode="check", occ=0, top_min=548, top_max=562)
for opt, k in [("Employment", "employment"), ("Disability", "disability"), ("VA Benefits", "va")]:
    field(2, "income_" + k, "income_sources~" + opt, opt, mode="check", top_min=572, top_max=586)
field(2, "income_other", "income_other", "Other", mode="after", occ=0, top_min=572, top_max=586, width=110)
field(2, "veteran_yes", "veteran=Yes", "Yes", mode="check", top_min=596, top_max=610)
field(2, "veteran_no", "veteran=No", "No", mode="check", top_min=596, top_max=610)
field(2, "initial_screening_date", "initial_screening_date", "Initial Screening Date", mode="after", width=140, role="staff")
field(2, "initial_assessment_date", "initial_assessment_date", "Initial Assessment Date", mode="after", width=140, role="staff")
field(2, "official_admission_date", "official_admission_date", "Official Admission Date", mode="after", width=140, role="staff")
field(2, "client_email", "client_email", "Address", mode="compound", notes="Address",
      occ=0, top_min=710, width=230, required=True)
field(2, "guardian_email", "guardian_email", "Address", mode="compound", notes="Address",
      occ=1, top_min=710, width=160)

# ── page 3: client screening form ───────────────────────────────────────────
field(3, "referral_date", "referral_date", "Referral Date:", mode="blank_after", width=160)
for anchor, val in [("Alliance", "Alliance"), ("Partners", "Partners BH"), ("Trillium", "Trillium"),
                    ("Vaya", "Vaya"), ("AmeriHealth", "AmeriHealth"), ("Carolina Complete", "Carolina Complete"),
                    ("Healthy Blue", "Healthy Blue Medicaid"), ("United Healthcare", "United Healthcare"),
                    ("Wellcare", "Wellcare")]:
    field(3, "mco_" + norm(val).replace(" ", "_"), "mco=" + val, anchor, mode="check",
          top_min=142, top_max=168)
REF_FOR = [("Case Management", "___Case Management"), ("Case Support", "___Case Support"),
           ("Community Support Team", "___Community Support Team"),
           ("Comprehensive Clinical Assessment", "___Comprehensive Clinical Assessment"),
           ("Diagnostic Assessment", "___Diagnostic Assessment"),
           ("Individual Support Services", "___Individual Support Services"),
           ("In-Home Therapy Services", "___In-Home Therapy Services"),
           ("Intensive In-Home Services", "___Intensive In-Home Services"),
           ("Medication Management", "___Medication Management"),
           ("Outpatient Therapy", "___Outpatient Therapy"),
           ("Peer Support Services", "___Peer Support Services"),
           ("Residential Level III", "___Residential Level III"),
           ("Substance Abuse Intensive Outpatient", "___Substance Attentive Intensive")]
for label, anchor in REF_FOR:
    field(3, "reffor_" + norm(label).replace(" ", "_").replace("-", "_"), "referred_for~" + label,
          anchor, mode="check_on_blank")
field(3, "diag_yes", "has_current_diagnosis=Yes", "___Y", occ=0, mode="check_on_blank")
field(3, "diag_no", "has_current_diagnosis=No", "___N", occ=0, mode="check_on_blank")
field(3, "diagnosis_list", "diagnosis_list", "If yes list below", mode="below", lines=4, h=11.6)
field(3, "therapist_yes", "has_current_therapist=Yes", "___Y", occ=1, mode="check_on_blank")
field(3, "therapist_no", "has_current_therapist=No", "___N", occ=1, mode="check_on_blank")
field(3, "therapist_name", "therapist_name", "If yes, Name", mode="after", width=210)
field(3, "medicaid_yes", "has_medicaid=Yes", "___Y", occ=2, mode="check_on_blank")
field(3, "medicaid_no", "has_medicaid=No", "___N", occ=2, mode="check_on_blank")
field(3, "mid2", "mid_number", "If yes MID#", mode="after", width=180)
field(3, "medicaid_eff2", "medicaid_effective_date", "Effective Date:", occ=0, mode="blank_after", width=160)
field(3, "ive_eligible", "dss_ive_eligible", "eligible?", mode="blank_after", width=60)
field(3, "nchc_yes", "has_nchc=Yes", "___Y", occ=3, mode="check_on_blank")
field(3, "nchc_no", "has_nchc=No", "___N", occ=3, mode="check_on_blank")
field(3, "nchc_policy", "nchc_policy", "Policy", mode="blank_after", width=170)
field(3, "nchc_eff", "nchc_effective_date", "Effective Date:", occ=1, mode="blank_after", width=160)
field(3, "staff_receiving", "staff_receiving_intake", "Staff Person receiving Intake call",
      mode="below", dy=-24, width=230, lines=1, role="staff", notes="name on blank above caption")
field(3, "screen_date", "screening_date", "Date", occ=0, mode="below", dy=-24, width=80,
      role="staff", top_min=560, top_max=585)
field(3, "qp_referred_to", "qp_referred_to", "QP referred to", mode="below", dy=-24, width=110, role="staff")
field(3, "can_meet_yes", "program_can_meet_needs=Yes", "___Y", occ=4, mode="check_on_blank", role="staff")
field(3, "can_meet_no", "program_can_meet_needs=No", "___N", occ=4, mode="check_on_blank", role="staff")
field(3, "cannot_meet_desc", "program_cannot_meet_desc", "individual referred:", mode="below",
      lines=3, h=11.6, role="staff")
field(3, "admission_date", "admission_date", "Admission Date:", mode="blank_after", width=180, role="staff")

# ── page 4: presenting problem ──────────────────────────────────────────────
field(4, "presenting_problem", "presenting_problem", "Presenting Problem", mode="below",
      lines=4, h=11.6, required=True, top_max=135)
field(4, "placement", "placement_considerations", "Placement (Match) Considerations", mode="below", lines=4, h=11.6)
field(4, "needs", "needs", "Needs", mode="after", top_min=240, width=430)
field(4, "strengths", "strengths", "Strengths", mode="after", width=430)
field(4, "abilities", "abilities", "Abilities", mode="after", width=430)
field(4, "preferences", "preferences", "Preferences", mode="after", width=430)
field(4, "diagnosis", "diagnosis_list", "Diagnosis", mode="after", top_min=290, width=430)
field(4, "social_history", "social_family_medical_history", "Pertinent Social, Family, or Medical History",
      mode="below", lines=6, h=11.6)
for opt, k in [("Psychological", "psych"), ("Substance Abuse", "sa"), ("Psychiatric", "psychiatric"),
               ("Educational", "edu"), ("Vocational", "voc"), ("Other", "other")]:
    field(4, "eval_" + k, "additional_evals~" + opt, "__" + opt, mode="check_on_blank", top_min=500)

# ── page 5: admission assessment ────────────────────────────────────────────
field(5, "assess_date", "intake_date", "Date of Assessment:", mode="blank_after", width=180)
for opt in ["Female", "Male", "Transgender"]:
    field(5, "a_gender_" + norm(opt), "gender=" + opt, opt, mode="check", top_min=145, top_max=158)
field(5, "a_street", "address_street", "Street Address:", mode="blank_after", width=260)
field(5, "a_home", "client_phone_home", "Home:", mode="blank_after", width=180)
field(5, "a_mobile", "client_phone_cell", "Mobile:", mode="blank_after", width=180)
field(5, "a_fax", "fax", "Not Secure", mode="after", width=120)
RS = ["DSS", "LME", "Provider Agency", "Self", "State Facility", "Private Physician",
      "Employer", "School", "Voc. Rehab", "Family/Friend", "Inpatient/Outpatient"]
for label in RS:
    field(5, "rs_" + norm(label).replace(" ", "_").replace(".", "").replace("/", "_"),
          "referral_source=" + (label if label != "Inpatient/Outpatient" else "Inpatient/Outpatient Facility"),
          label, mode="check", top_min=230, top_max=292)
field(5, "rs_social", "referral_source=Social Agency", "Social Agency", mode="check", top_min=250, top_max=270)
field(5, "social_agency_name", "social_agency_name", "Social Agency", mode="compound", notes="Agency",
      top_min=250, top_max=270, width=120)
field(5, "a_medicaid", "has_medicaid=Yes", "Medicaid", mode="check", top_min=300, top_max=316)
field(5, "a_medicare", "has_medicare=Yes", "Medicare", mode="check", top_min=300, top_max=316)
field(5, "a_fund_other", "funding_other", "Other", mode="after", occ=0, top_min=300, top_max=316, width=140)
for opt, k in [("Employment", "employment"), ("Disability", "disability"), ("VA Benefits", "va")]:
    field(5, "a_income_" + k, "income_sources~" + opt, opt, mode="check", top_min=324, top_max=338)
field(5, "a_presenting", "presenting_problem", "feel need for services", mode="below", lines=6, h=11.6)
field(5, "a_agencies", "other_agencies", "currently receiving services", mode="below", lines=3, h=11.6)
SVC = [("CST", "CST"), ("IIH", "IIH"), ("OPT", "OPT"), ("Med Mgt", "Med Mgt"),
       ("Residential", "Residential"), ("Case Support", "Case Support"), ("Peer Support", "Peer Support"),
       ("CCA", "CCA"), ("Psychological Eval.", "Psychological Eval."),
       ("Individual Support", "Individual Support"), ("In-Home Therapy Service", "In-Home Therapy Service")]
for label, anchor in SVC:
    field(5, "svc_" + norm(label).replace(" ", "_").replace(".", "").replace("-", "_"),
          "services_requested~" + label, anchor, mode="check", top_min=497, top_max=538)
field(5, "svc_other", "services_other", "Other", mode="after", top_min=518, top_max=538, width=60)
# 'lives with' shares one token with 'Where?' - anchor right after 'with:' so
# the answer fills the first blank instead of colliding with the Where? blank
field(5, "lives_with", "lives_with_whom", "with:", mode="compound", notes="with:",
      top_min=540, top_max=560, width=180)
field(5, "lives_where", "lives_where", "Where", mode="compound", notes="Where?", top_min=540, top_max=560, width=110)
field(5, "home_relations", "effects_on_home", "relate to others in the home", mode="below", lines=2, h=11.6)
field(5, "mh_yes", "receiving_mh_services=Yes", "Yes", mode="check", top_min=624, top_max=638)
field(5, "mh_no", "receiving_mh_services=No", "No", mode="check", top_min=624, top_max=638)
field(5, "mh_desc", "mh_services_desc", "If yes Describe", mode="after", width=300, lines=1)
field(5, "mh_provider", "mh_service_provider", "Service Provider", mode="after", width=300)
# the history answer gets one ruled line at the bottom of page 5 and two more
# at the top of page 6 - wrap it once (flowLines=3) and render each slice
field(5, "mh_history", "mh_history", "History of Mental Health Issues?", mode="below",
      lines=1, h=11.6, width=430, flowLines=3)

# ── page 6: severity of need ────────────────────────────────────────────────
field(6, "mh_history_cont", "mh_history", "___", mode="on_raw", occ=0,
      top_min=95, top_max=105, width=430, h=23.2, lines=2, startLine=1, flowLines=3)
field(6, "current_diag_known", "current_diagnosis_known", "Current Diagnosis if known", mode="after", width=300)
field(6, "sev_emergent", "severity_of_need=Emergent", "Emergent (2", mode="check", role="staff")
field(6, "sev_urgent", "severity_of_need=Urgent", "Urgent (48", mode="check", role="staff")
field(6, "sev_routine", "severity_of_need=Routine", "Routine (14", mode="check", role="staff")
field(6, "sev_nonthreshold", "severity_of_need=Non-Threshold", "Non-Threshold Clinical Need", mode="check", role="staff")

# ── page 7: medical & legal ─────────────────────────────────────────────────
field(7, "limit_yes", "has_limitations=Yes", "Yes", mode="check", top_min=148, top_max=162)
field(7, "limit_no", "has_limitations=No", "No", mode="check", top_min=148, top_max=162)
field(7, "limit_desc", "limitations_desc", "If yes Describe", mode="after", width=375, flowLines=3)
field(7, "limit_desc_cont", "limitations_desc", "___", mode="on_raw", occ=0,
      top_min=172, top_max=183, width=375, h=23.2, lines=2, startLine=1, flowLines=3)
p7 = PAGES[6]
tok = p7.find_raw("Telephone", occ=0, top_min=205, top_max=222)
if tok:  # the blank run and the word Telephone share one token: '_____Telephone'
    span = tok["x1"] - tok["x0"]
    wdt = span * max(len(tok["text"]) - 9, 1) / len(tok["text"]) - 8
    emit(p7, "pcp_name", "pcp_name", "text", tok["x0"] + 3, tok["top"], wdt, 11)
else:
    miss(7, "pcp_name", "telephone token missing")
tok = p7.find_raw("#", occ=0, top_min=205, top_max=222)
if tok:
    emit(p7, "pcp_phone", "pcp_phone", "text", tok["x0"] + 8, tok["top"], 140, 11)
else:
    miss(7, "pcp_phone", "phone blank not found")
field(7, "pref_er", "preferred_emergency_facility", "Preferred Emergency Facility", mode="after", width=300)
field(7, "medical_diag", "medical_diagnoses", "Medical Diagnosis", mode="after", width=420, lines=2)
field(7, "treatments", "treatments", "Treatment", mode="blank_after", top_min=276, top_max=292, width=420, lines=2)
field(7, "medications", "medications", "Medications:", mode="blank_after", width=420, lines=3)
field(7, "hosp", "hospitalizations", "Hospitalizations and Surgeries", mode="after", width=295, lines=1, flowLines=2)
field(7, "hosp2", "hospitalizations", "Hospitalizations and Surgeries", mode="below",
      lines=1, h=11.6, width=295, startLine=1, flowLines=2)
field(7, "ace", "ace_events", "ACE is present)", mode="below", lines=3, h=11.6)
field(7, "allergies", "allergies", "Allergies", mode="after", top_min=414, top_max=428, width=430)
field(7, "last_physical", "last_physical_date", "Date of Last Physical Examination?", mode="blank_after", width=250)
field(7, "court_yes", "pending_court_cases=Yes", "Y", occ=0, mode="check", top_min=488, top_max=500)
field(7, "court_no", "pending_court_cases=No", "N", occ=0, mode="check", top_min=488, top_max=500)
field(7, "court_desc", "court_case_desc", "If yes, describe", mode="below", lines=2, h=11.6)
field(7, "minor_yes", "is_minor_or_incompetent=Yes", "Y", occ=0, mode="check", top_min=522, top_max=534)
field(7, "minor_no", "is_minor_or_incompetent=No", "N", occ=0, mode="check", top_min=522, top_max=534)
field(7, "legal_guardian", "guardian_name", "Legal Guardian", mode="after", width=280)
field(7, "lg_address", "guardian_address", "Address", occ=0, mode="after", top_min=545, top_max=558, width=300)
field(7, "lg_phone", "guardian_phone", "Phone#", occ=0, mode="after", top_min=556, top_max=570, width=160)
field(7, "ec_name", "ec1_name", "Emergency Contact", mode="after", top_min=580, top_max=592, width=280)
field(7, "ec_address", "ec1_street", "Address", occ=0, mode="after", top_min=590, top_max=604, width=300)
field(7, "ec_phone", "ec1_cell_phone", "Phone#", occ=0, mode="after", top_min=602, top_max=616, width=160)

# ── page 8: substance abuse ─────────────────────────────────────────────────
field(8, "sa_denies", "sa_status=Denies", "Denies", mode="check", top_min=176, top_max=192)
field(8, "sa_yes", "sa_status=Yes", "Yes", mode="check", top_min=176, top_max=192)
field(8, "sa_no", "sa_status=No", "No", mode="check", top_min=176, top_max=192)
p8 = PAGES[7]
SA_ROWS = [("1st", 0, "sub1"), ("2nd", 0, "sub2"), ("3rd", 0, "sub3"), ("Other", 0, "sub4"), ("Other", 1, "sub5")]
SA_COLS = [(100, 90, "name"), (196, 62, "age_first"), (263, 64, "freq"),
           (331, 70, "route"), (405, 76, "amount"), (486, 72, "last_used")]
for label, occ, prefix in SA_ROWS:
    bb = p8.find(label, occ=occ, top_min=246, top_max=310)
    if not bb:
        miss(8, prefix, "row label %r missing" % label)
        continue
    for x, wd, col in SA_COLS:
        emit(p8, "%s_%s" % (prefix, col), "%s_%s" % (prefix, col), "text", x, bb["top"], wd, 10, fs=7.5)
field(8, "sa_primary", "sa_primary_diagnosis", "Primary Diagnosis", mode="after", width=250)
field(8, "sa_secondary", "sa_secondary_diagnosis", "Secondary Diagnosis", mode="after", width=250)
bb = p8.find("Signature of Clinician completing")
if bb:
    emit(p8, "sig_clinician_p8", "clinician_signature", "signature", 40, bb["bottom"] + 1, 180, 24,
         role="clinician", notes="clinician signs in staff review")
    emit(p8, "sig_clinician_p8_date", "clinician_sign_date", "text", 300, bb["bottom"] + 8, 90, 11, role="clinician")

# ── page 9: ability to provide (staff) ──────────────────────────────────────
field(9, "able_yes", "ability_to_provide=Yes", "has the ability to provide", mode="check",
      dx=-38, role="staff")
field(9, "able_no", "ability_to_provide=No", "does not have the ability", mode="check",
      dx=-38, role="staff")
sig_pair(9, "Signature of Clinician", 0, "sig_clinician_p9", None, role="clinician",
         source="clinician_signature", date_x_min=200)

# ── page 10: emergency information ──────────────────────────────────────────
field(10, "e_street", "address_street", "Address", mode="compound", notes="Address",
      occ=0, top_min=114, top_max=128, width=380)
field(10, "e_city", "address_city", "City", mode="compound", notes="City", occ=0,
      top_min=114, top_max=128, width=130)
field(10, "e_state", "address_state", "State", mode="compound", notes="State", occ=0,
      top_min=114, top_max=128, width=26)
phone_line(10, 0, "e_home", "e_work", "e_cell", "client_")
field(10, "height", "height", "Height", mode="after", width=56)
field(10, "weight", "weight", "Weight", mode="after", width=56)
field(10, "hair", "hair_color", "Hair Color", mode="after", width=64)
field(10, "eyes", "eye_color", "Eye Color", mode="after", width=70)
field(10, "med_alerts", "medical_alerts", "Medical Alerts and Conditions", mode="after", width=360, lines=2)
field(10, "drug_allergies", "drug_allergies", "Drug Allergies", mode="after", width=400)
field(10, "env_allergies", "environmental_allergies", "Environmental Allergies", mode="after", width=380)
field(10, "e_medications", "medications", "Medications", occ=0, mode="after",
      top_min=234, top_max=250, width=440, lines=2)
field(10, "otc", "otc_medications", "Over The Counter Medications", mode="after", width=340)
field(10, "marks", "identifying_marks", "Tatoos", mode="after", width=340)
field(10, "diets", "special_diets", "Special Diets", mode="after", width=400)
RISK = [("Substance Abuse", "sa"), ("BEH", "beh"), ("Suicidal", "suicidal"), ("Psychotic", "psychotic"),
        ("Behavioral Issues", "behavioral"), ("Physical Aggression", "phys_agg"),
        ("Verbal Aggression", "verb_agg"), ("SIB", "sib"), ("Property Destruction", "prop"),
        ("Other Behaviors", "other")]
for label, k in RISK:
    field(10, "risk_" + k, "at_risk_types~" + label, label, mode="check", top_min=322, top_max=370, role="staff")
for opt in ["English", "Spanish", "French", "German"]:
    field(10, "lang_" + norm(opt), "language=" + opt, opt, mode="check", top_min=390, top_max=404)
field(10, "lang_other", "language_other", "Other", mode="after", top_min=390, top_max=404, width=140)
for opt in ["Excellent", "Good", "Fair", "Poor"]:
    field(10, "comm_" + norm(opt), "communication_level=" + opt, opt, mode="check", top_min=408, top_max=422)
field(10, "e_pcp", "pcp_name", "Physician", occ=0, mode="after", top_min=494, top_max=510, width=300)
field(10, "e_pcp_addr", "pcp_address", "Address", occ=0, mode="after", top_min=528, top_max=544, width=300)
p10 = PAGES[9]
tok = p10.find_raw("#", occ=0, top_min=560, top_max=580)
if tok:
    emit(p10, "e_pcp_phone", "pcp_phone", "text", tok["x0"] + 8, tok["top"], 200, 11)
else:
    miss(10, "e_pcp_phone", "pcp phone blank missing")
field(10, "e_facility", "preferred_emergency_facility", "Facility", occ=0, mode="after",
      top_min=598, top_max=612, width=300)
field(10, "no_pcp", "no_pcp_nearest_er=true", "I do not have a primary care", mode="check", dx=-4)
sig_pair(10, "Client Signature/Guardian Signature", 0, "sig_emergency_info",
         "consent_emergency_info")
field(10, "ec1_name", "ec1_name", "Emergency Contact Name", mode="after", width=300, required=True)
field(10, "ec1_street", "ec1_street", "Address", mode="compound", notes="Address",
      occ=0, top_min=684, top_max=700, width=380)
field(10, "ec1_city", "ec1_city", "City", mode="compound", notes="City", occ=0, top_min=684, top_max=700, width=130)
field(10, "ec1_state", "ec1_state", "State", mode="compound", notes="State", occ=0, top_min=684, top_max=700, width=26)
phone_line(10, 1, "ec1_home", "ec1_work", "ec1_cell", "ec1_")

# ── page 11: provider choice ────────────────────────────────────────────────
for label in ["AmeriHealth", "Alliance", "Blue Cross Blue Shield", "Partners Behavioral Health",
              "Carolina Complete", "Sandhills Center/Trillium", "Healthy Blue", "Vaya",
              "Medicaid", "United Health Care", "Wellcare"]:
    field(11, "pc_" + norm(label).replace(" ", "_").replace("/", "_"),
          "provider_choice_plan=" + label, label, mode="check", top_min=200, top_max=390)
sig_pair(11, "Client/Guardian Signature", 0, "sig_provider_choice", "consent_provider_choice")

# ── pages 13/16/18: orientation, rights, bill of rights ─────────────────────
sig_pair(13, "Client/Guardian Signature", 0, "sig_orientation", "consent_orientation")
sig_pair(16, "Client/Guardian Signature", 0, "sig_rights", "consent_rights")
sig_pair(18, "Client/Guardian Signature", 0, "sig_bill", "consent_bill_of_rights")

# consent-for-treatment initials (items 1-2 on p16, 3-6 on p17)
for pg, items in [(16, ["__1.", "__2."]), (17, ["__3.", "__4.", "__5.", "__6."])]:
    for it in items:
        field(pg, "init_t" + it.strip("_."), "initials", it, mode="raw", ftype="initials",
              consent="consent_treatment", top_min=80)
field(17, "oncall_name", "client_full_name", "I,", mode="blank_after", width=280, top_min=248, top_max=266)

# ── pages 19-21: release of information x3 ──────────────────────────────────
ROI_ITEMS = [("Admission/ Screening Assessment", "adm"), ("HIV related information", "hiv"),
             ("Service Notes", "notes"), ("VO", "vo"),
             ("Medication history/ physician orders", "meds"), ("Psychological testing", "testing"),
             ("Service Plan", "plan"), ("LME", "lme"), ("Discharge Information", "discharge"),
             ("Substance Abuse Information", "sa"), ("Psychiatric Evaluation", "psycheval"),
             ("Reciprocal exchange permitted", "recip"), ("Accounting of Disclosure Report", "acct"),
             ("NCTOPPS", "nctopps")]
for pg, pre in [(19, "roi1"), (20, "roi2"), (21, "roi3")]:
    field(pg, pre + "_client", "client_full_name", "give Moore Divine", mode="blank_before", width=240)
    field(pg, pre + "_recipient", pre + "_recipient", "This includes", mode="blank_before", width=200)
    for label, k in ROI_ITEMS:
        field(pg, "%s_item_%s" % (pre, k), "%s_items~%s" % (pre, label), label,
              mode="check", top_min=250, top_max=380, consent=pre + "_agreed")
    field(pg, pre + "_item_other", pre + "_items_other", "Other:", mode="after", width=100,
          top_min=250, top_max=380, consent=pre + "_agreed")
    purp = PAGES[pg - 1].find("Purpose of Disclosure")
    if purp:
        for label, k in [("Continuity of Care", "coc"), ("Referral", "referral"), ("Legal", "legal"),
                         ("Service Delivery", "delivery"), ("Service Authorization", "auth")]:
            field(pg, "%s_purpose_%s" % (pre, k), "%s_purpose=%s" % (pre, label), label,
                  mode="check", top_min=purp["top"] - 4, top_max=purp["top"] + 14,
                  consent=pre + "_agreed")
    else:
        miss(pg, pre + "_purpose", "Purpose of Disclosure anchor missing")
    for occ, k in [(0, "fed"), (1, "hiv_law")]:
        field(pg, "%s_ack_%s" % (pre, k), "initials", "___I", occ=occ, mode="raw",
              ftype="initials", consent=pre + "_agreed")
    field(pg, "%s_ack_voluntary" % pre, "initials", "authorization is made freely",
          mode="blank_before", ftype="initials", width=14, consent=pre + "_agreed")
    p = PAGES[pg - 1]
    tok = p.find_raw("Representative__")
    if tok:
        emit(p, pre + "_sig", "signature", "signature", frac_x(tok, "Representative"),
             tok["top"] - 24, 150, 26, consentKey=pre + "_agreed")
        field(pg, pre + "_date", "sign_date", "Date", occ=0, mode="compound", notes="Date",
              top_min=tok["top"] - 4, top_max=tok["top"] + 6, width=80, consent=pre + "_agreed")
        field(pg, pre + "_thru", pre + "_thru_date", "Date", occ=1, mode="compound", notes="Date",
              top_min=tok["top"] - 4, top_max=tok["top"] + 6, width=70, consent=pre + "_agreed")
    else:
        miss(pg, pre + "_sig", "Representative blank missing")

# ── page 22: transport ──────────────────────────────────────────────────────
field(22, "transport_dest", "transport_destination", "provide transportation to", mode="blank_after", width=170)
sig_pair(22, "Parent/Guardian's Signature", 0, "sig_transport_guardian",
         "consent_transport", role="guardian", source="guardian_signature")
sig_pair(22, "Client Signature", 0, "sig_transport_client", "consent_transport")

# ── page 23: emergency care ─────────────────────────────────────────────────
p23 = PAGES[22]
bb = p23.find("guardian I,")
if bb:
    blank = p23.next_blank(bb)
    if blank:
        emit(p23, "ecare_name", "signer_name", "text", blank["x0"] + 3, blank["top"],
             blank["x1"] - blank["x0"] - 6, 11)
    else:
        miss(23, "ecare_name", "blank after 'guardian I,' missing")
else:
    miss(23, "ecare_name", "'guardian I,' anchor missing")
for occ, pre in [(0, "ec1"), (1, "ec2")]:
    field(23, "%sb_name" % pre, "%s_name" % pre, "Name", occ=occ, mode="after", top_min=310, width=300)
    field(23, "%sb_street" % pre, "%s_street" % pre, "Contact Street Address", occ=occ,
          mode="after", top_min=310, width=380)
    phone_line(23, occ, "%sb_home" % pre, "%sb_work" % pre, "%sb_cell" % pre, pre + "_")
sig_pair(23, "Parent/Guardian's/Client Signature", 0, "sig_ecare", "consent_emergency_care")

# ── page 24: emergency interventions ────────────────────────────────────────
field(24, "int_targets", "intervention_target_behaviors", "target behaviors of:", mode="blank_after", width=250)
field(24, "int_until", "intervention_valid_until", "_______(enter", mode="on_raw", width=56, h=11)
sig_pair(24, "Parent/Guardian's Signature", 0, "sig_int_guardian",
         "consent_emergency_interventions", role="guardian", source="guardian_signature")
sig_pair(24, "Client Signature", 0, "sig_int_client", "consent_emergency_interventions")

# ── pages 25-27: transition / discharge summary (staff) ─────────────────────
field(25, "dis_admission_date", "dis_admission_date", "Date of Admission:", mode="blank_after", width=130, role="staff")
field(25, "dis_discharge_date", "dis_discharge_date", "Date of Transition/Discharge:", mode="blank_after", width=110, role="staff")
field(25, "dis_programs", "dis_programs", "Program(s) client served in:", mode="blank_after", width=280, role="staff")
p25 = PAGES[24]
axis_rows = sorted({round(w["top"], 1) for w in p25.words
                    if w["n"] == "axis" and w["x0"] < 60 and 320 < w["top"] < 460})
for n, top in enumerate(axis_rows[:5], start=1):
    emit(p25, "dis_adm_axis%d" % n, "dis_adm_axis%d" % n, "text", 92, top, 250, 11, role="staff")
    emit(p25, "dis_dc_axis%d" % n, "dis_dc_axis%d" % n, "text", 402, top, 140, 11, role="staff")
if len(axis_rows) < 5:
    miss(25, "dis_axis_rows", "found only %d axis rows" % len(axis_rows))
field(25, "dis_summary", "dis_summary", "Identify presenting needs", mode="below", lines=3, role="staff")
field(25, "dis_pcp_plan", "dis_pcp_plan", "progress toward meeting goals", mode="below", lines=3, role="staff")
field(25, "dis_s", "dis_strengths", "S___", mode="on_raw", role="staff")
field(25, "dis_n", "dis_needs", "N___", mode="on_raw", role="staff")
field(25, "dis_a", "dis_abilities", "A___", mode="on_raw", role="staff")
field(25, "dis_p", "dis_preferences", "P___", mode="on_raw", role="staff")
field(25, "dis_reason", "dis_reason", "Reason for discharge/transition:", mode="below", lines=3, role="staff")
field(26, "dis_continuing", "dis_continuing_care", "level of that care", mode="below", lines=3, role="staff")
field(26, "dis_comments", "dis_comments", "Additional Comments:", mode="below", lines=3, role="staff")
for label, k in [("Private Home", "private"), ("Foster Care Placement:", "foster")]:
    field(26, "dis_res_" + k, "dis_residence_type=" + label.rstrip(":"), label, mode="check", role="staff")
field(26, "dis_res_alf", "dis_residence_type=ALF/Residential/Group Home/Halfway House",
      "ALF/Residential/Group", mode="check", role="staff")
field(26, "dis_res_inpatient", "dis_residence_type=Inpatient Psych/State Hospital/Medical Hospital",
      "In-Patient Psych/State", mode="check", role="staff")
field(26, "dis_res_detail", "dis_residence_detail", "Relationship):", mode="blank_after", width=250, role="staff")
for label, k in [("Psychiatric", "psych"), ("Medical", "medical"), ("Therapy", "therapy"),
                 ("Labs", "labs"), ("Support Group", "support"), ("Drop-in", "dropin")]:
    field(26, "dis_fu_" + k, "dis_followup_" + k, label, mode="after", top_min=430, top_max=520,
          width=140, role="staff")
field(26, "dis_meds", "dis_medications", "Medications (name/dosage/frequency):", mode="below", lines=3, role="staff")
field(26, "dis_pharmacy", "dis_pharmacy", "Pharmacy:", mode="below", lines=1, role="staff")
field(26, "dis_emp_where", "dis_employment_where", "Where", mode="after", top_min=600, width=130, role="staff")
field(26, "dis_client_comments", "dis_client_comments", "Comments:", mode="after", width=380, role="staff")
field(27, "dis_crisis_name", "dis_crisis_contact", "call:", mode="after", width=240, role="staff", top_max=120)
field(27, "dis_ind_sig", "signature", "Individual__", mode="on_raw", ftype="signature",
      width=140, h=22, consent="consent_discharge", notes="individual signs at discharge")
field(27, "dis_guardian_sig", "guardian_signature", "Guardian/Parent/Significant", mode="compound",
      notes="Other", ftype="signature", width=140, h=22, role="guardian", consent="consent_discharge")
field(27, "dis_prepared", "dis_prepared_by", "by__", mode="on_raw", width=180, role="staff")
field(27, "dis_copy_initials", "initials", "(initials)__", mode="raw", ftype="initials",
      consent="consent_discharge")

# ── page 27: treatment plan participation ───────────────────────────────────
field(27, "tpp_name", "client_full_name", "have met in person", mode="blank_before", width=240)
sig_pair(27, "Parent/Guardian's Signature", 0, "sig_tpp_guardian",
         "consent_treatment_plan_participation", role="guardian", source="guardian_signature")
sig_pair(27, "Client Signature", 0, "sig_tpp_client", "consent_treatment_plan_participation")

# ── page 28: receipt of treatment plan ──────────────────────────────────────
field(28, "rtp_name", "client_full_name", "have received and understand", mode="blank_before", width=240)
sig_pair(28, "Parent/Guardian's Signature", 0, "sig_rtp_guardian",
         "consent_receipt_treatment_plan", role="guardian", source="guardian_signature")
sig_pair(28, "Client Signature", 0, "sig_rtp_client", "consent_receipt_treatment_plan")

# ── pages 29-30: PCP collaboration form (staff-prefilled) ───────────────────
field(29, "c_to", "pcp_name", "To:", mode="blank_after", width=220, role="staff")
field(29, "c_phone", "pcp_phone", "Phone:", occ=0, mode="blank_after", width=140, role="staff")
field(29, "c_practice", "c_practice", "Name of practice", mode="after", width=200, role="staff")
field(29, "c_fax", "c_secure_fax", "Secure Fax:", occ=0, mode="blank_after", width=130, role="staff")
field(29, "c_address", "pcp_address", "Address:", occ=0, mode="blank_after", width=220, role="staff")
field(29, "c_email", "c_secure_email", "Secure Email:", mode="blank_after", width=130, role="staff")
field(29, "c_agency_fax", "c_agency_secure_fax", "Provider Agency Secure Fax:", mode="blank_after", width=110, role="staff")
field(29, "c_client", "client_full_name", "Client Name:", mode="blank_after", width=200, role="auto", top_min=300)
field(29, "c_medicaid", "mid_number", "Medicaid:", mode="blank_after", width=200, role="auto", top_min=300)
field(29, "c_dob", "dob", "Date of Birth:", mode="blank_after", width=200, role="auto", top_min=300)
for label, k in [("Coordination of care", "coc"), ("Patient determined to be Mentally", "mi"),
                 ("Medication Change", "medchange"), ("Significant change in diagnosis", "diagchange"),
                 ("Transferring care back to PCP", "transfer"), ("Annual Notification", "annual")]:
    field(29, "c_reason_" + k, "c_reason~" + label, label, mode="check", role="staff", top_min=430)
field(29, "c_req_meddiag", "c_requested~Medical Diagnosis", "Medical Diagnosis", mode="check",
      role="staff", top_min=640)
field(30, "c_req_meds", "c_requested~List of all medications", "List of all medications", mode="check", role="staff")
field(30, "c_req_bha", "c_requested~Behavioral Health Assessment", "Behavioral Health Assessment Date", mode="check", role="staff")
field(30, "c_req_isp", "c_requested~Individual Service Plan", "Individual Service Plan Date", mode="check", role="staff")
field(30, "c_req_impression", "c_requested~Clinical Impression", "Clinical Impression", mode="check", role="staff")
field(30, "c_req_other", "c_requested_other", "Other information", mode="blank_after", width=200, role="staff")
for axis in ["I", "II", "III", "IV", "V"]:
    field(30, "c_axis" + axis.lower(), "c_axis" + str(len(axis)), "Axis %s:" % axis,
          mode="blank_after", width=140, role="staff")
field(30, "c_psych_name", "c_psych_name", "Assistant Name:", mode="blank_after", width=220, role="staff")
field(30, "c_psych_email", "c_psych_email", "Email Address:", occ=0, mode="blank_after", width=180, role="staff")
field(30, "c_psych_phone", "c_psych_phone", "Phone:", occ=0, mode="blank_after", width=120, role="staff", top_min=280)
field(30, "c_cm_name", "c_cm_name", "Assigned Case Manager Name:", mode="blank_after", width=220, role="staff")
field(30, "c_cm_email", "c_cm_email", "Email Address:", occ=1, mode="blank_after", width=180, role="staff")
field(30, "c_cm_phone", "c_cm_phone", "Phone:", occ=1, mode="blank_after", width=120, role="staff", top_min=280)
field(30, "c_other_name", "c_other_name", "Other Contact Name:", mode="blank_after", width=240, role="staff")
field(30, "c_other_email", "c_other_email", "Email Address:", occ=2, mode="blank_after", width=180, role="staff")
field(30, "c_other_phone", "c_other_phone", "Phone:", occ=2, mode="blank_after", width=120, role="staff", top_min=280)
field(30, "c_clinician", "c_clinician", "Clinician completing form:", mode="blank_after", width=200, role="staff")
field(30, "c_clin_title", "c_clinician_title", "Title:", occ=0, mode="blank_after", width=130, role="staff", top_min=560)
field(30, "c_date_sent", "c_date_sent", "Date Sent:", occ=0, mode="blank_after", width=100, role="staff")
for label in ["Mailed", "Faxed", "Emailed"]:
    field(30, "c_sent_" + norm(label), "c_sent_method=" + label, label, mode="check", role="staff", top_min=640)

# ── page 34: HIPAA acknowledgment ───────────────────────────────────────────
field(34, "hipaa_understood", "hipaa_understood=true", "I understand the information that was explained",
      mode="check", dx=-2, consent="consent_hipaa")
field(34, "hipaa_copy", "hipaa_copy=true", "I was given a copy of this information",
      mode="check", dx=-2, consent="consent_hipaa")
p34 = PAGES[33]
bb = p34.find("Parent/Legal Guardian/Client Signature")
if bb:
    emit(p34, "sig_hipaa", "signature", "signature", 40, bb["top"] - 40, 170, 28,
         consentKey="consent_hipaa")
    d = p34.find_raw("Date__", occ=0, top_min=405, top_max=420)
    if d:
        emit(p34, "sig_hipaa_date", "sign_date", "text", frac_x(d, "Date"), d["top"], 90, 11,
             consentKey="consent_hipaa")
else:
    miss(34, "sig_hipaa", "caption missing")

# ── pages 35-37: confidentiality exceptions ─────────────────────────────────
field(35, "conf_name", "client_full_name", "understand that Moore Divine", mode="blank_before", width=200)
sig_pair(37, "/Guardian Signature", 0, "sig_conf", "consent_confidentiality",
         top_min=590, date_x_min=300)

# ── page 38: welcome letter ─────────────────────────────────────────────────
field(38, "welcome_name", "client_full_name", "Dear", mode="after", width=240, fs=10)

# ── page 39: client initial survey ──────────────────────────────────────────
p39 = PAGES[38]
for key, anchor in [("survey_q1", "I got into the program"), ("survey_q2", "The staff was courteous"),
                    ("survey_q3", "The staff explained Orientation"), ("survey_q4", "I was allowed and encouraged"),
                    ("survey_q5", "I was informed whether I was qualified"),
                    ("survey_q6", "I participated in the development"),
                    ("survey_q7", "The facilities are clean"), ("survey_q8", "I was explained the evacuation"),
                    ("survey_q9", "I would recommend Moore Divine")]:
    bb = p39.find(anchor)
    if bb:
        emit(p39, key, key, "survey_rating", 524, bb["top"], 42, 11, fs=10,
             notes="selected 1-3 written at right edge of question")
    else:
        miss(39, key, "survey anchor missing")

# ── page 40: referrals for services ─────────────────────────────────────────
p40 = PAGES[39]
for i in range(1, 11):
    tok = p40.find_raw("%d." % i, occ=0, top_min=150)
    if not tok or tok["top"] < 150:
        miss(40, "referral%d" % i, "row missing")
        continue
    emit(p40, "ref%d_name" % i, "ref%d_name" % i, "text", tok["x0"] + 16, tok["top"], 240, 11)
    emit(p40, "ref%d_phone" % i, "ref%d_phone" % i, "text", 372, tok["top"], 160, 11)

# ── page 41: CCA signature page ─────────────────────────────────────────────
p41 = PAGES[40]
bb = p41.find("Printed name of Client")
if bb:
    emit(p41, "cca_client_printed", "client_full_name", "text", bb["x0"], bb["top"] - 16, 170, 11, fs=10)
    emit(p41, "cca_client_sig", "signature", "signature", 300, bb["top"] - 32, 140, 28,
         consentKey="consent_cca")
    emit(p41, "cca_client_date", "sign_date", "text", 452, bb["top"] - 15, 90, 11, consentKey="consent_cca")
bb = p41.find("Printed name of Legal Guardian")
if bb:
    emit(p41, "cca_guardian_printed", "guardian_name", "text", bb["x0"], bb["top"] - 16, 170, 11,
         fs=10, role="guardian")
    emit(p41, "cca_guardian_sig", "guardian_signature", "signature", 299, bb["top"] - 32, 140, 28,
         role="guardian", consentKey="consent_cca")
    emit(p41, "cca_guardian_date", "sign_date", "text", 453, bb["top"] - 15, 90, 11,
         role="guardian", consentKey="consent_cca")
bb = p41.find("Printed Name of Licensed Clinician")
if bb:
    emit(p41, "cca_clinician_printed", "clinician_name", "text", bb["x0"], bb["top"] - 16, 170, 11,
         fs=10, role="clinician")
    emit(p41, "cca_clinician_sig", "clinician_signature", "signature", 302, bb["top"] - 32, 120, 28,
         role="clinician")
    emit(p41, "cca_clinician_date", "clinician_sign_date", "text", 434, bb["top"] - 15, 90, 11, role="clinician")
bb = p41.find("Printed Name of Medical Director")
if bb:
    emit(p41, "cca_md_printed", "medical_director_name", "text", bb["x0"], bb["top"] - 16, 170, 11,
         fs=10, role="medicalDirector")
    emit(p41, "cca_md_sig", "medical_director_signature", "signature", 300, bb["top"] - 32, 130, 28,
         role="medicalDirector")
    emit(p41, "cca_md_date", "medical_director_sign_date", "text", 447, bb["top"] - 15, 90, 11,
         role="medicalDirector")
bb = p41.find("Signature of participant")
if bb:
    for r in range(4):
        y = bb["bottom"] + 8 + r * 26
        emit(p41, "cca_part%d_sig" % (r + 1), "cca_part%d_name" % (r + 1), "text", 40, y, 220, 11, role="staff")
        emit(p41, "cca_part%d_rel" % (r + 1), "cca_part%d_rel" % (r + 1), "text", 274, y, 140, 11, role="staff")
        emit(p41, "cca_part%d_date" % (r + 1), "cca_part%d_date" % (r + 1), "text", 430, y, 100, 11, role="staff")

# ── page 42: outpatient treatment plan signature rows ───────────────────────
p42 = PAGES[41]
bb = p42.find("Client/Legally Responsible/Guardian Signature")
if bb:
    for r in range(3):
        y = bb["bottom"] + 14 + r * 44
        emit(p42, "otp_row%d_staff_date" % (r + 1), "otp_row%d_staff_date" % (r + 1), "text",
             71, y, 60, 11, role="staff")
        emit(p42, "otp_row%d_staff_sig" % (r + 1), "staff_signature", "signature", 113, y - 6, 130, 24,
             role="staff", notes="row %d" % (r + 1))
        emit(p42, "otp_row%d_client_date" % (r + 1), "otp_row%d_client_date" % (r + 1), "text",
             291, y, 60, 11)
        emit(p42, "otp_row%d_client_sig" % (r + 1), "signature", "signature", 360, y - 6, 150, 24,
             consentKey="consent_treatment_plan_participation", notes="row %d" % (r + 1))
else:
    miss(42, "otp_rows", "table header missing")
field(42, "otp_client_name", "client_full_name", "Client Name:", mode="after", width=170, top_min=180)
field(42, "otp_record", "record_number", "Record Number:", mode="after", width=110, top_min=180)

# ── page 43: tailored plan permission ───────────────────────────────────────
field(43, "tp_name", "client_full_name", "then I", mode="blank_after", width=150)
p43 = PAGES[42]
bb = p43.find("Consumer Signature:")
if bb:
    blank = p43.next_blank(bb)
    if blank:
        emit(p43, "tp_sig", "signature", "signature", blank["x0"] + 2, bb["top"] - 16, 120, 24,
             consentKey="consent_tailored_plan")
    d = p43.find("Date:", occ=0, top_min=bb["top"] - 5, top_max=bb["top"] + 10)
    if d:
        db = p43.next_blank(d)
        if db:
            emit(p43, "tp_date", "sign_date", "text", db["x0"] + 3, bb["top"], 80, 11,
                 consentKey="consent_tailored_plan")
else:
    miss(43, "tp_sig", "Consumer Signature caption missing")

# ---------------------------------------------------------------------------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump({"template": "MooreDivineCare_Intake_Packet-1.pdf", "pageCount": len(PAGES),
               "pageWidth": PAGES[0].w, "pageHeight": PAGES[0].h, "fields": ENTRIES}, f, indent=1)
print("wrote %d field placements -> %s" % (len(ENTRIES), OUT))
print("misses: %d" % len(MISSES))
for m in MISSES:
    print("  MISS", m)
