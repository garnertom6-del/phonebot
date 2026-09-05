#!/usr/bin/env python3
"""
build_certificates.py -- print-ready Certificates of Completion, one per training.

Reads the same three inputs build_training.py reads -- agency_config.json,
profile.json and training_catalog.json -- and emits, into training/certificates/:

  NN_<id>.pdf            one landscape certificate per applicable training
  00_ALL_CERTIFICATES.pdf every certificate in one print job
  html/NN_<id>.html      the same design as self-contained HTML

The PDF is the production path: ReportLab draws it directly, so it needs no
browser, no network and no Adobe Fonts, and renders identically on Windows and
Linux. The HTML is the hand-off path -- push any one of those files to Adobe
Express when you want to restyle the template with real Adobe Fonts.

The certificate carries the provider agency as the headline name, because the
document lives in that agency's personnel file and a DHSR surveyor reads it as
that agency's training record. Successful Solutions appears as the curriculum
preparer.

Nothing on the certificate implies state issuance: the rosette is an ornament,
not a seal, and no NCDHHS or DHSR mark appears anywhere.

Usage:  python3 build_certificates.py       (run from the per-provider build dir)
"""
import io, json, os, sys, glob

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))

# Landscape US Letter. ReportLab works in points; 1 inch = 72 pt.
PAGE_W, PAGE_H = landscape(letter)          # 792 x 612
INCH = 72.0

NAVY = HexColor("#1F365C")                  # the engine's house navy
GOLD = HexColor("#C0A468")                  # hairline / ornament gold
GOLD_TEXT = HexColor("#9A7B4F")             # darker gold, passes contrast as text
INK = HexColor("#2A2A2A")
MUTED = HexColor("#6B6B6B")
FAINT = HexColor("#8C8C8C")
RULE_GRAY = HexColor("#9A9A9A")
PAPER = HexColor("#FCFBF8")

PREPARER = os.environ.get("CERT_PREPARER", "Successful Solutions")


# ------------------------------------------------------------------ fonts ---
# Candidate files per role, best first. Adobe Fonts (Essonnes, Acumin Pro) are
# not installable here, so the PDF uses a Times-class serif and an Arial-class
# sans -- both entirely at home on an official training record. The HTML twin
# keeps the Adobe faces for the Express route.
FONT_CANDIDATES = {
    "CertSerif": [
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "C:/Windows/Fonts/georgia.ttf",
        "C:/Windows/Fonts/times.ttf",
    ],
    "CertSerif-Bold": [
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "C:/Windows/Fonts/georgiab.ttf",
        "C:/Windows/Fonts/timesbd.ttf",
    ],
    "CertSans": [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ],
    "CertSans-Bold": [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ],
    "CertSans-Italic": [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
        "C:/Windows/Fonts/ariali.ttf",
    ],
}

# If a role cannot be registered, fall back to a ReportLab built-in of the same
# metric class rather than failing the build.
BUILTIN_FALLBACK = {
    "CertSerif": "Times-Roman",
    "CertSerif-Bold": "Times-Bold",
    "CertSans": "Helvetica",
    "CertSans-Bold": "Helvetica-Bold",
    "CertSans-Italic": "Helvetica-Oblique",
}

FONT = {}


def register_fonts():
    """Resolve each role to a usable font name. Never raises."""
    for role, paths in FONT_CANDIDATES.items():
        chosen = None
        for p in paths:
            if os.path.exists(p):
                try:
                    pdfmetrics.registerFont(TTFont(role, p))
                    chosen = role
                    break
                except Exception:
                    continue
        FONT[role] = chosen or BUILTIN_FALLBACK[role]
    substituted = [r for r in FONT_CANDIDATES if FONT[r] != r]
    if substituted:
        print(f"    fonts: using built-ins for {len(substituted)} role(s) "
              f"(no system TTF found)")


# ----------------------------------------------------------------- config ---
def cfg_and_profile():
    cfg = json.load(io.open("agency_config.json", encoding="utf-8"))
    prof = json.load(io.open("profile.json", encoding="utf-8")) \
        if os.path.exists("profile.json") else {}
    return cfg, prof


def applies(t, prof):
    """Identical rule to build_training.py -- the two packs must never diverge."""
    a = t.get("applies", {})
    svc_ok = (a.get("saiop") and prof.get("SAIOP")) or \
             (a.get("psr") and prof.get("PSR"))
    if not svc_ok:
        return False
    req = t.get("requires", {})
    if req.get("adolescent") and not prof.get("ADOLESCENT"):
        return False
    if req.get("ri") and not prof.get("RI"):
        return False
    return True


# --------------------------------------------------------------- drawing ----
def y(inches_from_top):
    """The design is specified from the top edge; ReportLab measures from the
    bottom. One conversion here keeps every coordinate below readable."""
    return PAGE_H - inches_from_top * INCH


def text_width(s, font, size, charspace=0.0):
    w = pdfmetrics.stringWidth(s, font, size)
    if charspace and len(s) > 1:
        w += charspace * (len(s) - 1)
    return w


def centered(c, s, y_in, font, size, color, charspace=0.0):
    """Draw one centred line, honouring letter-spacing."""
    if not s:
        return
    w = text_width(s, font, size, charspace)
    t = c.beginText()
    t.setTextOrigin((PAGE_W - w) / 2.0, y(y_in))
    t.setFont(font, size)
    t.setFillColor(color)
    # Always set it, including 0. A ReportLab text object inherits the canvas's
    # current character spacing, so skipping this when charspace is 0 lets the
    # spacing from a previous letter-spaced line leak in -- which silently
    # widens the line past what text_width measured, and past the frame.
    t.setCharSpace(charspace)
    t.textOut(s)
    c.drawText(t)


def fit_lines(s, font, max_size, min_size, max_width, max_lines=2):
    """Shrink, then wrap, until the string fits. Returns (lines, size)."""
    size = max_size
    while size >= min_size:
        if text_width(s, font, size) <= max_width:
            return [s], size
        if max_lines > 1:
            words, lines, cur = s.split(), [], ""
            for wd in words:
                trial = (cur + " " + wd).strip()
                if text_width(trial, font, size) <= max_width:
                    cur = trial
                else:
                    if cur:
                        lines.append(cur)
                    cur = wd
            if cur:
                lines.append(cur)
            if len(lines) <= max_lines and \
               all(text_width(l, font, size) <= max_width for l in lines):
                return lines, size
        size -= 0.5
    return [s], min_size


def rosette(c, cx_in, cy_in, r_in):
    """A decorative rosette. Deliberately abstract -- it carries no lettering
    and no emblem, so it can never be mistaken for a state seal."""
    cx, cy, r = cx_in * INCH, y(cy_in), r_in * INCH
    c.setLineWidth(2.4 * r / 36.0)
    c.setStrokeColor(NAVY)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setLineWidth(1.1 * r / 36.0)
    c.setStrokeColor(GOLD)
    c.circle(cx, cy, r * 0.85, stroke=1, fill=0)
    c.setLineWidth(0.9 * r / 36.0)
    c.circle(cx, cy, r * 0.43, stroke=1, fill=0)
    # eight radiating ticks between the inner and outer rings
    import math
    c.setStrokeColor(NAVY)
    c.setLineWidth(1.6 * r / 36.0)
    c.setLineCap(1)
    for i in range(8):
        a = math.radians(i * 45.0)
        x0, y0 = cx + math.cos(a) * r * 0.52, cy + math.sin(a) * r * 0.52
        x1, y1 = cx + math.cos(a) * r * 0.68, cy + math.sin(a) * r * 0.68
        c.line(x0, y0, x1, y1)
    c.setFillColor(GOLD)
    c.circle(cx, cy, r * 0.15, stroke=0, fill=1)


def draw_certificate(c, t, cfg):
    """One certificate on the current page."""
    ser, serb = FONT["CertSerif"], FONT["CertSerif-Bold"]
    san, sanb = FONT["CertSans"], FONT["CertSans-Bold"]
    sani = FONT["CertSans-Italic"]

    # paper
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # double frame
    c.setStrokeColor(NAVY)
    c.setLineWidth(2.5)
    c.rect(0.34 * INCH, 0.34 * INCH, 10.32 * INCH, 7.82 * INCH, stroke=1, fill=0)
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.75)
    c.rect(0.46 * INCH, 0.46 * INCH, 10.08 * INCH, 7.58 * INCH, stroke=1, fill=0)

    # corner brackets
    c.setLineWidth(1.5)
    arm, ins = 0.34 * INCH, 0.58 * INCH
    L, R = ins, PAGE_W - ins
    B, T = ins, PAGE_H - ins
    for (hx, hy, dx, dy) in ((L, T, 1, -1), (R, T, -1, -1),
                             (L, B, 1, 1), (R, B, -1, 1)):
        c.line(hx, hy, hx + dx * arm, hy)
        c.line(hx, hy, hx, hy + dy * arm)

    # header
    centered(c, "STAFF TRAINING RECORD", 1.02, san, 7.5, GOLD_TEXT, 1.65)
    prov = (cfg.get("legal_name") or "").upper()
    plines, psize = fit_lines(prov, sanb, 13.5, 9.5, 8.6 * INCH, max_lines=1)
    centered(c, plines[0], 1.325, sanb, psize, NAVY, psize * 0.15)
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.0)
    c.line((PAGE_W - 0.9 * INCH) / 2, y(1.56),
           (PAGE_W + 0.9 * INCH) / 2, y(1.56))

    # display
    centered(c, "Certificate of Completion", 2.42, ser, 46, NAVY)

    # recital + name rule
    centered(c, "This certifies that", 2.89, sani, 11, MUTED)
    c.setStrokeColor(NAVY)
    c.setLineWidth(1.0)
    c.line((PAGE_W - 5.6 * INCH) / 2, y(3.40),
           (PAGE_W + 5.6 * INCH) / 2, y(3.40))
    centered(c, "PRINTED NAME AND CREDENTIAL", 3.56, san, 7.5, FAINT, 1.05)
    centered(c, "has successfully completed and demonstrated competence in",
             4.03, sani, 11, MUTED)

    # training title -- shrink and wrap rather than overflow the frame
    title = t.get("title", "")
    tlines, tsize = fit_lines(title, serb, 24, 15, 9.0 * INCH, max_lines=2)
    ty = 4.53 if len(tlines) == 1 else 4.36
    for i, line in enumerate(tlines):
        centered(c, line, ty + i * (tsize * 1.15 / INCH), serb, tsize, NAVY)

    # citation
    cite = t.get("cite", "")
    cy0 = 4.95 if len(tlines) == 1 else 5.02
    clines, csize = fit_lines(cite, san, 8, 6.5, 8.6 * INCH, max_lines=2)
    for i, line in enumerate(clines):
        centered(c, line, cy0 + i * 0.14, san, csize, HexColor("#7A7A7A"))

    # compliance fields -- the part a surveyor actually reads
    labels = ["DATE COMPLETED", "SCORE / RESULT", "INSTRUCTOR",
              "NEXT REFRESHER DUE"]
    total_w, gap = 8.6 * INCH, 0.35 * INCH
    col_w = (total_w - gap * 3) / 4.0
    x0 = (PAGE_W - total_w) / 2.0
    c.setStrokeColor(RULE_GRAY)
    c.setLineWidth(0.75)
    for i, lab in enumerate(labels):
        cx = x0 + i * (col_w + gap)
        c.line(cx, y(5.86), cx + col_w, y(5.86))
        w = text_width(lab, san, 7, 0.91)
        tt = c.beginText()
        tt.setTextOrigin(cx + (col_w - w) / 2.0, y(6.06))
        tt.setFont(san, 7)
        tt.setFillColor(MUTED)
        tt.setCharSpace(0.91)
        tt.textOut(lab)
        c.drawText(tt)

    rosette(c, 5.5, 6.91, 0.39)

    centered(c, "Retain this certificate in the employee personnel file for at "
                "least three years.", 7.55, sani, 8, HexColor("#7A7A7A"))
    centered(c, f"CURRICULUM PREPARED BY {PREPARER.upper()}", 7.74,
             san, 7, GOLD_TEXT, 1.12)


# ------------------------------------------------------------------ html ----
HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Certificate of Completion \u2014 {title_esc}</title>
<meta name="hz:slide-selector" content=".certificate">
<meta name="hz:canvas-width" content="1056">
<meta name="hz:canvas-height" content="816">
<link rel="stylesheet" href="https://use.typekit.net/giq4gbv.css">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ display:flex; justify-content:center; align-items:center;
       min-height:100vh; background:#e7e5e0; }}
.certificate {{ position:relative; width:11in; height:8.5in;
               background:#FCFBF8; overflow:hidden; }}
.frame-outer {{ position:absolute; top:0.34in; left:0.34in; width:10.32in;
               height:7.82in; border:2.5pt solid #1F365C; }}
.frame-inner {{ position:absolute; top:0.46in; left:0.46in; width:10.08in;
               height:7.58in; border:0.75pt solid #C0A468; }}
.corner {{ position:absolute; width:0.34in; height:0.34in; }}
.corner-tl {{ top:0.58in; left:0.58in; border-top:1.5pt solid #C0A468;
             border-left:1.5pt solid #C0A468; }}
.corner-tr {{ top:0.58in; right:0.58in; border-top:1.5pt solid #C0A468;
             border-right:1.5pt solid #C0A468; }}
.corner-bl {{ bottom:0.58in; left:0.58in; border-bottom:1.5pt solid #C0A468;
             border-left:1.5pt solid #C0A468; }}
.corner-br {{ bottom:0.58in; right:0.58in; border-bottom:1.5pt solid #C0A468;
             border-right:1.5pt solid #C0A468; }}
.col {{ position:absolute; left:1in; width:9in; text-align:center; }}
.eyebrow {{ top:0.92in; font-family:"acumin-pro",sans-serif; font-weight:500;
           font-size:7.5pt; letter-spacing:0.22em; text-transform:uppercase;
           color:#9A7B4F; }}
.provider {{ top:1.14in; font-family:"acumin-pro",sans-serif; font-weight:600;
            font-size:13.5pt; letter-spacing:0.15em; text-transform:uppercase;
            color:#1F365C; }}
.rule-short {{ position:absolute; top:1.56in; left:5.05in; width:0.9in;
              border-bottom:1pt solid #C0A468; }}
.display {{ top:1.76in; font-family:"essonnes-headline",serif; font-weight:400;
           font-size:46pt; line-height:1.06; color:#1F365C; }}
.recital {{ font-family:"acumin-pro",sans-serif; font-weight:400;
           font-style:italic; font-size:11pt; color:#6B6B6B; }}
.recital-1 {{ top:2.74in; }}
.recital-2 {{ top:3.88in; }}
.nameline {{ position:absolute; top:3.06in; left:2.7in; width:5.6in;
            height:0.34in; border-bottom:1pt solid #1F365C; }}
.namecap {{ top:3.44in; font-family:"acumin-pro",sans-serif; font-weight:400;
           font-size:7.5pt; letter-spacing:0.14em; text-transform:uppercase;
           color:#8C8C8C; }}
.training {{ top:4.24in; font-family:"essonnes-headline",serif;
            font-weight:700; font-size:24pt; line-height:1.15; color:#1F365C; }}
.citation {{ top:4.84in; font-family:"acumin-pro",sans-serif; font-weight:400;
            font-size:8pt; color:#7A7A7A; }}
.fields {{ position:absolute; top:5.52in; left:1.2in; width:8.6in;
          display:flex; gap:0.35in; }}
.field {{ width:1.8875in; }}
.field-rule {{ height:0.34in; border-bottom:0.75pt solid #9A9A9A; }}
.field-label {{ margin-top:0.08in; font-family:"acumin-pro",sans-serif;
               font-weight:500; font-size:7pt; letter-spacing:0.13em;
               text-transform:uppercase; color:#6B6B6B; text-align:center; }}
.rosette {{ position:absolute; top:6.52in; left:5.11in; width:0.78in;
           height:0.78in; }}
.retention {{ top:7.44in; font-family:"acumin-pro",sans-serif;
             font-style:italic; font-size:8pt; color:#7A7A7A; }}
.preparer {{ top:7.64in; font-family:"acumin-pro",sans-serif; font-weight:500;
            font-size:7pt; letter-spacing:0.16em; text-transform:uppercase;
            color:#9A7B4F; }}
</style>
</head>
<body>
<div class="certificate" data-canvas-width="1056" data-canvas-height="816">
  <div class="frame-outer"></div>
  <div class="frame-inner"></div>
  <div class="corner corner-tl"></div><div class="corner corner-tr"></div>
  <div class="corner corner-bl"></div><div class="corner corner-br"></div>
  <div class="col eyebrow">Staff Training Record</div>
  <div class="col provider">{provider_esc}</div>
  <div class="rule-short"></div>
  <h1 class="col display">Certificate of Completion</h1>
  <p class="col recital recital-1">This certifies that</p>
  <div class="nameline"></div>
  <p class="col namecap">Printed name and credential</p>
  <p class="col recital recital-2">has successfully completed and demonstrated
     competence in</p>
  <h2 class="col training">{title_esc}</h2>
  <p class="col citation">{cite_esc}</p>
  <div class="fields">
    <div class="field"><div class="field-rule"></div>
      <div class="field-label">Date Completed</div></div>
    <div class="field"><div class="field-rule"></div>
      <div class="field-label">Score / Result</div></div>
    <div class="field"><div class="field-rule"></div>
      <div class="field-label">Instructor</div></div>
    <div class="field"><div class="field-rule"></div>
      <div class="field-label">Next Refresher Due</div></div>
  </div>
  <svg class="rosette" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="46" fill="none" stroke="#1F365C" stroke-width="2.4"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="#C0A468" stroke-width="1.1"/>
    <circle cx="50" cy="50" r="20" fill="none" stroke="#C0A468" stroke-width="0.9"/>
    <g stroke="#1F365C" stroke-width="1.6" stroke-linecap="round">
      <line x1="50" y1="24" x2="50" y2="31"/><line x1="50" y1="69" x2="50" y2="76"/>
      <line x1="24" y1="50" x2="31" y2="50"/><line x1="69" y1="50" x2="76" y2="50"/>
      <line x1="31.6" y1="31.6" x2="36.6" y2="36.6"/>
      <line x1="63.4" y1="63.4" x2="68.4" y2="68.4"/>
      <line x1="68.4" y1="31.6" x2="63.4" y2="36.6"/>
      <line x1="36.6" y1="63.4" x2="31.6" y2="68.4"/>
    </g>
    <circle cx="50" cy="50" r="7" fill="#C0A468"/>
  </svg>
  <p class="col retention">Retain this certificate in the employee personnel
     file for at least three years.</p>
  <p class="col preparer">Curriculum prepared by {preparer_esc}</p>
</div>
</body>
</html>
"""


def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;"))


# ------------------------------------------------------------------ build ---
def main():
    cfg, prof = cfg_and_profile()
    cat = json.load(io.open(os.path.join(HERE, "training_catalog.json"),
                            encoding="utf-8"))
    trainings = [t for t in cat["trainings"] if applies(t, prof)]

    if not trainings:
        print("    no trainings apply to this profile -- no certificates built")
        return 0

    register_fonts()

    out = os.path.join(HERE, "training", "certificates")
    hout = os.path.join(out, "html")
    os.makedirs(hout, exist_ok=True)

    # one combined PDF, plus one file per training
    allc = canvas.Canvas(os.path.join(out, "00_ALL_CERTIFICATES.pdf"),
                         pagesize=(PAGE_W, PAGE_H))
    allc.setTitle(f"Certificates of Completion -- {cfg.get('legal_name','')}")

    for n, t in enumerate(trainings, 1):
        draw_certificate(allc, t, cfg)
        allc.showPage()

        one = canvas.Canvas(os.path.join(out, f"{n:02d}_{t['id']}.pdf"),
                            pagesize=(PAGE_W, PAGE_H))
        one.setTitle(f"Certificate of Completion -- {t.get('title','')}")
        draw_certificate(one, t, cfg)
        one.showPage()
        one.save()

        io.open(os.path.join(hout, f"{n:02d}_{t['id']}.html"), "w",
                encoding="utf-8", newline="").write(HTML.format(
                    title_esc=esc(t.get("title", "")),
                    cite_esc=esc(t.get("cite", "")),
                    provider_esc=esc(cfg.get("legal_name", "")),
                    preparer_esc=esc(PREPARER)))

    allc.save()
    print(f"    certificates: {len(trainings)} pdf + {len(trainings)} html "
          f"+ combined pack")
    return 0


if __name__ == "__main__":
    sys.exit(main())
