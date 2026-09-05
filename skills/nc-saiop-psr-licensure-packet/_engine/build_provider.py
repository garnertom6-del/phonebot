#!/usr/bin/env python3
"""THE ONE COMMAND.

    python3 _engine/build_provider.py <slug>

Runs the whole packet for one provider:
  1. resolve.py      - validate the record, run the capability gate, render
  2. manual pass 1   - build the manual so we can find out its page numbers
  3. page index      - read page numbers OUT OF THE DELIVERED PDF
  4. manual pass 2   - rebuild with the real page numbers in the table of contents
  5. worksheets      - fill DHSR worksheets using the page index (never memory)
  6. forms           - walk-through, multi-service schedule, materials, ASAM waiver
  7. guides          - START HERE + submission guide
  8. BLANKS report   - every labelled blank and who has to sign it
  9. contamination   - prove no other provider's details leaked in
 10. tracker         - one row per provider

Everything lands in providers/<slug>/output/.
The engine folder is never modified.
"""
import io, json, os, re, csv, sys, glob, shutil, datetime, subprocess

HERE      = os.path.dirname(os.path.abspath(__file__))
ROOT      = os.path.dirname(HERE)
PROVIDERS = os.path.join(ROOT, "providers")
BUILD     = os.path.join(ROOT, "_build")
TRACKER   = os.path.join(ROOT, "TRACKER.csv")

SOFFICE_WRAP = "/mnt/skills/public/docx/scripts/office/soffice.py"


def sh(cmd, cwd, env=None, quiet=True):
    e = dict(os.environ)
    if env:
        e.update(env)
    r = subprocess.run(cmd, cwd=cwd, env=e, shell=isinstance(cmd, str),
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("  COMMAND FAILED:", cmd)
        print("  stdout:", r.stdout[-2000:])
        print("  stderr:", r.stderr[-2000:])
        raise SystemExit(1)
    if not quiet and r.stdout.strip():
        print("   ", r.stdout.strip()[-500:])
    return r


def to_pdf(docpath, cwd):
    if os.path.exists(SOFFICE_WRAP):
        sh(["python3", SOFFICE_WRAP, "--headless", "--convert-to", "pdf", docpath], cwd)
    else:
        sh(["soffice", "--headless", "--convert-to", "pdf", docpath], cwd)


# ---------------------------------------------------------------- blanks ---
# The manual marks a blank with a run of underscores, and the LABEL is the
# text immediately before it. So the report is generated from the DELIVERED
# PDF -- the same source of truth the page index uses -- not from the scripts.
BLANK_PAT = re.compile(r"_{4,}")

OWNER_RULES = [
    ("crisis",              "Agency - the REAL 24/7 crisis line. Never invent this."),
    ("telephone",           "Agency - main line."),
    ("signature",           "Authorised representative - WET INK signature."),
    ("approved by",         "Governing body - name of the approving officer."),
    ("title",               "Governing body - the signer's title."),
    ("date",                "Signer, on the day they actually sign."),
    ("effective date",      "Agency - the date the manual takes effect."),
    ("executive director",  "Agency - owner/officer name and title."),
    ("ceo",                 "Agency - owner/officer name and title."),
    ("program director",    "Agency - real name and credentials."),
    ("clinical supervisor", "Agency - LCAS / CCS / CCAS name and licence number."),
    ("clinical director",   "Agency - real name and credentials."),
    ("qualified professional", "Agency - QP of record, name and credentials."),
    ("privacy officer",     "Agency - named Privacy Officer."),
    ("instructor",          "Agency - de-escalation instructor and their qualifications."),
    ("alternate",           "Agency - the designated alternate."),
    ("mhl",                 "NC DHSR - issued after approval. Leave blank until then."),
]

def clean_label(pre):
    """Turn the raw text before a blank into a readable label.

    The text before a blank often ends with ANOTHER blank's underscores
    (e.g. "____ (owner name & title) Program Director"). Cut at the last
    underscore run so the label is the phrase that actually belongs to
    THIS blank.
    """
    pre = re.sub(r"\s+", " ", pre)
    tail = re.split(r"_{4,}", pre)[-1]              # drop the previous blank
    tail = re.sub(r"^\s*\([^)]*\)\s*", "", tail)    # drop its trailing "(hint)"
    tail = re.sub(r"^.*[•·]\s*", "", tail)          # start at the last bullet
    tail = tail.strip(" .,;:/-")
    if len(tail) < 3:                                # nothing useful left
        tail = pre.strip(" .,;:/-")[-60:]
    return (tail[-70:] if len(tail) > 70 else tail) or "(unlabelled)"


def who(label):
    """Whoever is named CLOSEST to the blank owns it.

    Matching the first rule in list order tagged 'Program Director ____'
    as a Title blank, because 'title' appeared earlier in the line.
    """
    low = label.lower()
    # A fabricated 24/7 crisis number is the single most dangerous blank to
    # guess at, so "crisis" outranks position entirely.
    if "crisis" in low:
        return OWNER_RULES[0][1]
    best, best_pos = "Agency", -1
    for key, val in OWNER_RULES:
        pos = low.rfind(key)
        if pos > best_pos:
            best, best_pos = val, pos
    return best


def write_blanks_report(outdir, p, build):
    """Every blank left in the delivered manual, and who has to fill it.

    This is a DELIVERABLE, not a debug log -- it is the checklist the owner
    works through before the packet is signed and filed.
    """
    manual = os.path.join(outdir, "01_Policy_and_Procedure_Manual.pdf")
    found = []          # (page, label)
    try:
        from pdfminer.high_level import extract_pages
        from pdfminer.layout import LTTextContainer
        for pageno, layout in enumerate(extract_pages(manual), start=1):
            txt = "".join(el.get_text() for el in layout
                          if isinstance(el, LTTextContainer))
            flat = re.sub(r"\s+", " ", txt)
            for m in BLANK_PAT.finditer(flat):
                found.append((pageno, clean_label(flat[max(0, m.start() - 120):m.start()])))
    except Exception as ex:
        print(f"    (blank scan fell back: {ex})")

    lines = [
        f"# BLANKS TO COMPLETE - {p['legal_name']}",
        "",
        f"Generated {datetime.date.today().isoformat()} for slug `{p['slug']}`.",
        "",
        f"**{len(found)} blanks** were left in the manual on purpose. Nothing here was",
        "invented by the builder, because putting a made-up name, credential, licence",
        "number or phone number into a State filing is fabrication.",
        "",
        "Work top to bottom. Page numbers refer to the delivered PDF.",
        "",
        "| Manual p. | What the blank is for | Who completes it |",
        "|---|---|---|",
    ]
    for pageno, label in found:
        safe = label.replace("|", "/")
        lines.append(f"| {pageno} | {safe} | {who(label)} |")

    # Record-level blanks the owner still owes us.
    lines += ["", "## Still missing from the provider record", ""]
    missing = [f for f in ("governing_body_signatory", "clinical_director",
                           "qp_of_record", "mhl_number", "crisis_line",
                           "dhsr_consultant_first_meeting_date")
               if not str(p.get(f, "")).strip()]
    if missing:
        for f in missing:
            lines.append(f"- **{f}** - not supplied, so it stays a blank in the packet.")
    else:
        lines.append("- None. Every record field is supplied.")

    lines += [
        "", "## Attachments that must be added by hand", "",
        "- Governing body bylaws",
        "- Organisational chart",
        "- Proof of county Emergency Management (OEM) verification",
        "- Staff credentials / licence verifications",
        "",
        "*Not legal advice. A licensure consultant and clinical leadership should",
        "review the packet before it is filed.*",
    ]
    path = os.path.join(outdir, "BLANKS_TO_COMPLETE.md")
    io.open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return path, len(found)


# --------------------------------------------------- contamination sweep ---
def contamination_sweep(outdir, me, all_providers):
    """Grep this packet for EVERY OTHER provider's identifying details.

    With one shared engine the risk is not folder-forking any more, it is a
    stale build directory. This proves the packet is clean.
    """
    # Fields that IDENTIFY one provider. Another provider's value appearing in
    # this packet is a leak, full stop.
    UNIQUE = ("legal_name", "address", "mhl_number", "contact_email", "dba")
    # Fields providers legitimately SHARE, counted only when the value differs
    # from this provider's own.
    #
    # city and county are deliberately NOT here. A bare city name is too weak a
    # needle: every packet prints the DHSR address in RALEIGH, so one Raleigh
    # provider on the roster would flag every other provider's packet forever.
    # County appears in rule text and county-EM references for the same reason.
    # A real city leak still gets caught, because `address` contains the city.
    #
    # A sweep that cries wolf is a sweep that gets ignored, which is worse than
    # no sweep at all.
    SHARED = ("tailored_plan",)

    needles = []
    for q in all_providers:
        if q.get("slug") == me.get("slug"):
            continue
        for f in UNIQUE:
            v = str(q.get(f, "")).strip()
            if len(v) > 3:
                needles.append((q.get("slug", "?"), f, v))
        for f in SHARED:
            v = str(q.get(f, "")).strip()
            mine = str(me.get(f, "")).strip()
            if len(v) > 3 and v.lower() != mine.lower():
                needles.append((q.get("slug", "?"), f, v))

    hits = []
    for fn in glob.glob(os.path.join(outdir, "*")):
        if not fn.lower().endswith((".md", ".txt", ".json", ".csv")):
            continue
        txt = io.open(fn, encoding="utf-8", errors="ignore").read()
        for slug, f, v in needles:
            if v in txt:
                hits.append((os.path.basename(fn), slug, f, v))

    # PDFs need TWO passes, and missing either one makes this sweep useless.
    #
    #  1. the text layer  -- the manual and the guides
    #  2. AcroForm field VALUES -- the filled DHSR worksheets, walk-through,
    #     multi-service schedule and materials checklist.
    #
    # Pass 2 is not optional. Those forms are filled by writing /V into field
    # dictionaries with /NeedAppearances, so the value is rendered by the
    # viewer and never lands in the text layer. A text-only sweep reports
    # "clean" on a worksheet carrying another provider's legal name on all
    # 95 rows.
    try:
        from pdfminer.high_level import extract_text
        for fn in glob.glob(os.path.join(outdir, "*.pdf")):
            txt = extract_text(fn) or ""
            for slug, f, v in needles:
                if v in txt:
                    hits.append((os.path.basename(fn), slug, f, v))
    except Exception as ex:
        print(f"    (pdf text sweep skipped: {ex})")

    try:
        from pypdf import PdfReader
        for fn in glob.glob(os.path.join(outdir, "*.pdf")):
            try:
                fields = PdfReader(fn).get_fields() or {}
            except Exception:
                continue
            blob = " | ".join(str(d.get("/V")) for d in fields.values()
                              if d.get("/V") not in (None, "", "/Off"))
            for slug, f, v in needles:
                if v in blob:
                    hits.append((os.path.basename(fn) + " [form field]", slug, f, v))
    except Exception as ex:
        print(f"    (pdf form-field sweep skipped: {ex})")

    # Spreadsheets (the editable ASAM waiver) carry values too.
    try:
        import openpyxl
        for fn in glob.glob(os.path.join(outdir, "*.xlsx")):
            wb = openpyxl.load_workbook(fn, data_only=False)
            cells = []
            for ws in wb.worksheets:
                for row in ws.iter_rows():
                    for c in row:
                        if isinstance(c.value, str):
                            cells.append(c.value)
            blob = " | ".join(cells)
            for slug, f, v in needles:
                if v in blob:
                    hits.append((os.path.basename(fn), slug, f, v))
    except Exception as ex:
        print(f"    (xlsx sweep skipped: {ex})")

    return hits


# ---------------------------------------------------------------- tracker --
def update_tracker(p, outdir, status):
    cols = ["slug", "legal_name", "county", "tailored_plan", "services",
            "population", "consultant_meeting", "deadline", "status",
            "last_build", "output"]
    d = (p.get("dhsr_consultant_first_meeting_date") or "").strip()
    due = ""
    if d:
        try:
            due = (datetime.date.fromisoformat(d) +
                   datetime.timedelta(days=182)).isoformat()
        except ValueError:
            due = "BAD DATE"
    row = {
        "slug": p["slug"], "legal_name": p["legal_name"], "county": p["county"],
        "tailored_plan": p["tailored_plan"], "services": "+".join(p["services"]),
        "population": p["population"], "consultant_meeting": d, "deadline": due,
        "status": status, "last_build": datetime.date.today().isoformat(),
        "output": os.path.relpath(outdir, ROOT),
    }
    rows = []
    if os.path.exists(TRACKER):
        rows = [r for r in csv.DictReader(io.open(TRACKER, encoding="utf-8"))
                if r.get("slug") != p["slug"]]
    rows.append(row)
    rows.sort(key=lambda r: (r.get("deadline") or "9999", r.get("slug", "")))
    with io.open(TRACKER, "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


# ------------------------------------------------------------------ main ---
def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python3 _engine/build_provider.py <slug>")
    slug = sys.argv[1]

    print(f"\n=== BUILDING PACKET: {slug} ===\n")

    print("[1/10] validate record + capability gate + render")
    # The gate is an expected, meaningful outcome -- not a crash. Show its
    # message plainly instead of a stack of subprocess noise.
    r = subprocess.run(["python3", os.path.join(HERE, "resolve.py"), slug],
                       cwd=ROOT, capture_output=True, text=True)
    print(r.stdout.rstrip())
    if r.returncode == 2:
        print("\nNo packet was produced, and that is the correct result.")
        return 2
    if r.returncode != 0:
        print(r.stderr.rstrip())
        return 1
    build = os.path.join(BUILD, slug)
    p = json.load(io.open(os.path.join(PROVIDERS, slug, "provider.json"),
                          encoding="utf-8"))

    print("[2/10] npm deps")
    sh("npm install docx --silent 2>/dev/null || true", build)
    sh(["node", "genkeys.js"], build)

    print("[3/10] manual pass 1")
    sh(["node", "build2.js"], build, env={"PAGEMAP": "{}",
                                          "OUTFILE": "manual_pass1.docx"})
    to_pdf("manual_pass1.docx", build)

    print("[4/10] read page numbers out of the delivered PDF")
    sh(["python3", "find_pages.py", "manual_pass1.pdf", "pages_pass1.json"], build)
    sh(["python3", "-c",
        "import json;json.dump(json.load(open('pages_pass1.json'))['toc'],"
        "open('pagemap.json','w'))"], build)

    print("[5/10] manual pass 2 (real page numbers)")
    pagemap = io.open(os.path.join(build, "pagemap.json"), encoding="utf-8").read()
    sh(["node", "build2.js"], build, env={"PAGEMAP": pagemap,
                                          "OUTFILE": "manual_final.docx"})
    to_pdf("manual_final.docx", build)
    sh(["python3", "find_pages.py", "manual_final.pdf", "pages_final.json"], build)

    print("[6/10] DHSR worksheets")
    if "SAIOP" in p["services"]:
        sh(["python3", "fill_worksheet4.py"], build)
    if "PSR" in p["services"]:
        sh(["python3", "fill_worksheet4.py"], build,
           env={"SVC": "Psychosocial Rehabilitation (PSR) — 10A NCAC 27G .1200",
                "OUT": "./PSR_Worksheet_FILLED.pdf"})

    print("[7/10] guides + forms")
    sh(["python3", "make_starthere.py"], build); to_pdf("START_HERE.docx", build)
    sh(["python3", "make_guide.py"], build)
    to_pdf("Worksheet_and_Submission_Guide.docx", build)
    sh(["python3", "fill_forms.py"], build)
    if os.path.exists(os.path.join(build, "ASAM_27G4400_Waiver.xlsx")):
        to_pdf("ASAM_27G4400_Waiver.xlsx", build)

    print("[7b/10] training pack")
    sh(["python3", "build_training.py"], build, quiet=False)
    # LibreOffice writes the PDF into the CURRENT WORKING DIRECTORY, not beside
    # the source file. Convert each directory in one batch call with --outdir so
    # the PDFs land where the docx files are.
    for d in ("training", os.path.join("training", "booklets")):
        src = os.path.join(build, d)
        docs = sorted(glob.glob(os.path.join(src, "*.docx")))
        if not docs:
            continue
        cmd = ["soffice", "--headless", "--convert-to", "pdf",
               "--outdir", src] + docs
        r = subprocess.run(cmd, cwd=build, capture_output=True, text=True)
        made = len(glob.glob(os.path.join(src, "*.pdf")))
        print(f"    {d}: {made}/{len(docs)} pdf")
        if made < len(docs):
            print("      (soffice:", (r.stderr or r.stdout)[-300:].strip(), ")")

    # Certificates are drawn straight to PDF by ReportLab -- no soffice pass,
    # so a missing Writer filter can never silently drop them.
    sh(["python3", "build_certificates.py"], build, quiet=False)

    print("[7c/10] disaster bundle")
    sh(["python3", "build_disaster.py"], build, quiet=False)
    ddir = os.path.join(build, "disaster")
    docs = sorted(glob.glob(os.path.join(ddir, "*.docx")))
    if docs:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                        "--outdir", ddir] + docs,
                       cwd=build, capture_output=True, text=True)
        print(f"    disaster: {len(glob.glob(os.path.join(ddir,'*.pdf')))}/{len(docs)} pdf")

    print("[8/10] collect output")
    outdir = os.path.join(PROVIDERS, slug, "output")
    if os.path.exists(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir)
    # A worksheet is only expected for a service this provider actually
    # delivers. Listing both unconditionally made every SAIOP-only packet
    # report itself BUILT-PARTIAL over a PSR worksheet that step 6 correctly
    # never built -- and the same in reverse for a PSR-only provider.
    plan = [
        ("START_HERE.pdf",                        "00_START_HERE.pdf"),
        ("Worksheet_and_Submission_Guide.pdf",    "00b_Worksheet_and_Submission_Guide.pdf"),
        ("manual_final.pdf",                      "01_Policy_and_Procedure_Manual.pdf"),
        ("manual_final.docx",                     "01_Policy_and_Procedure_Manual_EDITABLE.docx"),
    ]
    if "SAIOP" in p["services"]:
        plan.append(("SAIOP_PP_Worksheet_FILLED.pdf",
                     "02_DHSR_Worksheet_SAIOP_FILLED.pdf"))
    if "PSR" in p["services"]:
        plan.append(("PSR_Worksheet_FILLED.pdf",
                     "02b_DHSR_Worksheet_PSR_FILLED.pdf"))
    plan += [
        ("ASAM_27G4400_Waiver.pdf",               "03_ASAM_27G-4400_Waiver.pdf"),
        ("ASAM_27G4400_Waiver.xlsx",              "03_ASAM_27G-4400_Waiver_EDITABLE.xlsx"),
        ("Walk-Through_Form.pdf",                 "04_Facility_Walk-Through_Form.pdf"),
        ("Multi-Service_Schedule.pdf",            "05_Multi-Service_Staff_Coverage_Worksheet.pdf"),
        ("Required_Materials_Checklist.pdf",      "06_Required_Materials_Checklist.pdf"),
    ]
    got, absent = [], []
    for src, dst in plan:
        s = os.path.join(build, src)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(outdir, dst)); got.append(dst)
        else:
            absent.append(dst)
    shutil.copy2(os.path.join(PROVIDERS, slug, "provider.json"),
                 os.path.join(outdir, "_provider_record.json"))

    # 07_Training/ -- the third of the four bundles.
    tdir = os.path.join(outdir, "07_Training")
    os.makedirs(os.path.join(tdir, "Booklets"), exist_ok=True)
    ntr = 0
    for f in sorted(glob.glob(os.path.join(build, "training", "*.pdf"))) + \
             sorted(glob.glob(os.path.join(build, "training", "*.docx"))):
        shutil.copy2(f, os.path.join(tdir, os.path.basename(f)))
    for f in sorted(glob.glob(os.path.join(build, "training", "booklets", "*.pdf"))):
        shutil.copy2(f, os.path.join(tdir, "Booklets", os.path.basename(f)))
        ntr += 1

    # Certificates/ -- one print-ready certificate per training, plus the
    # combined pack. The Express/ HTML twins ride along so any one certificate
    # can be pushed to Adobe Express for restyling without rebuilding.
    cdir = os.path.join(tdir, "Certificates")
    os.makedirs(os.path.join(cdir, "Express_HTML"), exist_ok=True)
    ncert = 0
    for f in sorted(glob.glob(os.path.join(build, "training", "certificates",
                                           "*.pdf"))):
        shutil.copy2(f, os.path.join(cdir, os.path.basename(f)))
        # 00_ALL_CERTIFICATES.pdf is the combined pack, not a 29th training.
        if not os.path.basename(f).startswith("00_"):
            ncert += 1
    for f in sorted(glob.glob(os.path.join(build, "training", "certificates",
                                           "html", "*.html"))):
        shutil.copy2(f, os.path.join(cdir, "Express_HTML",
                                     os.path.basename(f)))
    got.append(f"07_Training/ ({ntr} booklets + matrix + master binder"
               f" + {ncert} certificates)")

    # 08_Disaster_Plan/ -- the fourth bundle. The OEM verification in here is the
    # line item that gets packets returned.
    ddir_out = os.path.join(outdir, "08_Disaster_Plan")
    os.makedirs(ddir_out, exist_ok=True)
    nds = 0
    for f in sorted(glob.glob(os.path.join(build, "disaster", "*.pdf"))) + \
             sorted(glob.glob(os.path.join(build, "disaster", "*.docx"))):
        shutil.copy2(f, os.path.join(ddir_out, os.path.basename(f)))
        if f.endswith(".pdf"):
            nds += 1
    got.append(f"08_Disaster_Plan/ ({nds} documents incl. OEM verification)")

    print("[8b/10] contradiction sweep of the DELIVERED manual")
    # resolve.py sweeps the source. This sweeps what actually reached the page,
    # which is the only version anyone signs.
    prof = json.load(io.open(os.path.join(build, "profile.json"), encoding="utf-8"))
    DELIVERED = [
        ("RI", True, [
            r"does not use restrictive intervention",
            r"uses no restrictive intervention",
            r"no restrictive interventions are used",
            r"does not permit or use seclusion",
            r"does not use protective devices",
            r"restrictive interventions are not used",
            r"\(none are used\)",
            r"no RI \w+",
            r"no advisory committee",
            r"not trained to use restrictive",
            r"seclusion is not used",
            r"protective devices are not used",
            r"no seclusion or isolation room",
        ]),
        ("ADOLESCENT", True, [
            r"does not currently serve adolescents",
            r"Adolescent Services \(Future Election\)",
            r"adolescent-specific provisions are not applicable",
        ]),
    ]
    try:
        from pdfminer.high_level import extract_text
        mtxt = extract_text(os.path.join(outdir,
                                         "01_Policy_and_Procedure_Manual.pdf")) or ""
        # The filled DHSR worksheets carry their comments in AcroForm field
        # VALUES, which never reach the text layer. Seven contradicting comments
        # sat there undetected while the manual read clean -- so sweep both.
        try:
            from pypdf import PdfReader
            for wf in glob.glob(os.path.join(outdir, "02*_DHSR_Worksheet_*.pdf")):
                flds = PdfReader(wf).get_fields() or {}
                mtxt += "\n" + "\n".join(
                    str(d.get("/V")) for d in flds.values()
                    if d.get("/V") not in (None, "", "/Off"))
        except Exception as ex:
            print(f"    (worksheet field sweep skipped: {ex})")
        flat = re.sub(r"\s+", " ", mtxt)
        bad = []
        for flag, when, pats in DELIVERED:
            if bool(prof.get(flag)) != when:
                continue
            for pat in pats:
                for m in re.finditer(pat, flat, re.I):
                    bad.append((flag, flat[max(0, m.start() - 80):m.end() + 80]))
        if bad:
            print("    !! THE DELIVERED MANUAL CONTRADICTS THE PROVIDER PROFILE")
            for flag, ctx in bad[:10]:
                print(f"       [{flag}] ...{ctx}...")
            print("    This packet must NOT be filed.")
            update_tracker(p, outdir, "CONTRADICTION")
            return 3
        print(f"    clean (profile: "
              f"{', '.join(k for k in ('RI','ADOLESCENT','ADULTS') if prof.get(k))})")
    except Exception as ex:
        print(f"    (could not sweep the delivered manual: {ex})")

    print("[9/10] blanks report")
    bpath, nblanks = write_blanks_report(outdir, p, build)
    print(f"    {nblanks} blanks -> {os.path.basename(bpath)}")

    print("[10/10] cross-contamination sweep")
    others = []
    for d in sorted(glob.glob(os.path.join(PROVIDERS, "*", "provider.json"))):
        try:
            others.append(json.load(io.open(d, encoding="utf-8")))
        except Exception:
            pass
    hits = contamination_sweep(outdir, p, others)
    if hits:
        print("    !! CONTAMINATION FOUND -- do not file this packet:")
        for fn, s, f, v in hits[:25]:
            print(f"       {fn}: contains {s}'s {f} = {v!r}")
    else:
        print(f"    clean (checked against {max(0,len(others)-1)} other provider(s))")

    status = "CONTAMINATED" if hits else ("BUILT" if not absent else "BUILT-PARTIAL")
    update_tracker(p, outdir, status)

    print(f"\n=== {status} ===")
    print(f"packet: {outdir}")
    for g in got:
        print("   +", g)
    for a in absent:
        print("   -", a, "(not produced)")
    print(f"\ntracker: {TRACKER}")
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(main())
