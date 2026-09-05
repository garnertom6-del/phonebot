"""Native PDF rendering for the CARF packet.

Renders the same Markdown subset as docx_kit, straight to PDF with ReportLab, so
the packet does not depend on LibreOffice or any other converter being installed.
"""
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

NAVY = colors.HexColor("#1F3B63")
GREY = colors.HexColor("#555555")
RED = colors.HexColor("#A81C1C")
HEADFILL = colors.HexColor("#E8EDF5")

_ss = getSampleStyleSheet()
S = {
    "body": ParagraphStyle("body", parent=_ss["Normal"], fontName="Helvetica",
                           fontSize=9, leading=12, spaceAfter=4),
    "h1": ParagraphStyle("h1", parent=_ss["Normal"], fontName="Helvetica-Bold",
                         fontSize=15, leading=18, textColor=NAVY,
                         spaceBefore=12, spaceAfter=5),
    "h2": ParagraphStyle("h2", parent=_ss["Normal"], fontName="Helvetica-Bold",
                         fontSize=12, leading=15, textColor=NAVY,
                         spaceBefore=9, spaceAfter=4),
    "h3": ParagraphStyle("h3", parent=_ss["Normal"], fontName="Helvetica-Bold",
                         fontSize=10, leading=13, spaceBefore=7, spaceAfter=3),
    "bullet": ParagraphStyle("bullet", parent=_ss["Normal"], fontName="Helvetica",
                             fontSize=9, leading=12, leftIndent=14,
                             bulletIndent=4, spaceAfter=2),
    "num": ParagraphStyle("num", parent=_ss["Normal"], fontName="Helvetica",
                          fontSize=9, leading=12, leftIndent=16, spaceAfter=2),
    "cell": ParagraphStyle("cell", parent=_ss["Normal"], fontName="Helvetica",
                           fontSize=7, leading=8.6),
    "cellhead": ParagraphStyle("cellhead", parent=_ss["Normal"],
                               fontName="Helvetica-Bold", fontSize=7, leading=8.6),
    "notice": ParagraphStyle("notice", parent=_ss["Normal"], fontName="Helvetica-Bold",
                             fontSize=9.5, leading=12, textColor=RED, spaceAfter=6),
    "t_agency": ParagraphStyle("t_agency", parent=_ss["Normal"], fontName="Helvetica-Bold",
                               fontSize=22, leading=26, textColor=NAVY, alignment=TA_CENTER),
    "t_title": ParagraphStyle("t_title", parent=_ss["Normal"], fontName="Helvetica-Bold",
                              fontSize=17, leading=21, alignment=TA_CENTER, spaceBefore=8),
    "t_sub": ParagraphStyle("t_sub", parent=_ss["Normal"], fontName="Helvetica",
                            fontSize=11, leading=14, textColor=GREY,
                            alignment=TA_CENTER, spaceBefore=6),
    "t_meta": ParagraphStyle("t_meta", parent=_ss["Normal"], fontName="Helvetica",
                             fontSize=9, leading=13, textColor=GREY, alignment=TA_CENTER),
    "t_warn": ParagraphStyle("t_warn", parent=_ss["Normal"], fontName="Helvetica-Bold",
                             fontSize=10, leading=13, textColor=RED,
                             alignment=TA_CENTER, spaceBefore=14),
}

MARGIN = 0.6 * inch
PAGE_W, PAGE_H = letter
AVAIL = PAGE_W - 2 * MARGIN


def esc(text):
    """Escape XML, then turn **bold** into ReportLab bold markup."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


def _table(rows):
    ncol = max(len(r) for r in rows)
    # Wide tables need a smaller face to stay on the page at all.
    style = S["cell"]
    head = S["cellhead"]
    if ncol > 9:
        style = ParagraphStyle("cellS", parent=style, fontSize=5.6, leading=6.8)
        head = ParagraphStyle("cellHS", parent=head, fontSize=5.6, leading=6.8)
    elif ncol > 6:
        style = ParagraphStyle("cellM", parent=style, fontSize=6.4, leading=7.8)
        head = ParagraphStyle("cellHM", parent=head, fontSize=6.4, leading=7.8)

    data = []
    for ri, row in enumerate(rows):
        cells = [row[c] if c < len(row) else "" for c in range(ncol)]
        data.append([Paragraph(esc(c), head if ri == 0 else style) for c in cells])

    # Column widths proportional to content length, floored so nothing collapses.
    weights = []
    for c in range(ncol):
        longest = max((len(r[c]) if c < len(r) else 0) for r in rows)
        weights.append(max(longest, 4) ** 0.6)
    total = sum(weights)
    widths = [max(AVAIL * w / total, 0.32 * inch) for w in weights]
    if sum(widths) > AVAIL:
        k = AVAIL / sum(widths)
        widths = [w * k for w in widths]

    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#AAAAAA")),
        ("BACKGROUND", (0, 0), (-1, 0), HEADFILL),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
        ("TOPPADDING", (0, 0), (-1, -1), 1.8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.8),
    ]))
    return t


def render_markdown(story, md, base_level=1):
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped:
            i += 1
            continue

        if stripped.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i].strip())
                i += 1
            rows = []
            for b in block:
                if re.fullmatch(r"\|[\s:|-]+\|", b):
                    continue
                rows.append([c.strip() for c in b.strip("|").split("|")])
            if rows:
                story.append(_table(rows))
                story.append(Spacer(1, 6))
            continue

        if stripped in ("---", "***", "___"):
            story.append(Spacer(1, 3))
            story.append(Table([[""]], colWidths=[AVAIL], rowHeights=[1],
                               style=TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.7, NAVY)])))
            story.append(Spacer(1, 5))
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            lvl = min(len(m.group(1)) + base_level - 1, 3)
            story.append(Paragraph(esc(m.group(2)), S[f"h{lvl}"]))
            i += 1
            continue

        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            story.append(Paragraph(esc(m.group(1)), S["bullet"], bulletText="•"))
            i += 1
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if m:
            story.append(Paragraph(f"{m.group(1)}. {esc(m.group(2))}", S["num"]))
            i += 1
            continue

        story.append(Paragraph(esc(stripped), S["body"]))
        i += 1


def rule(story):
    story.append(Spacer(1, 3))
    story.append(Table([[""]], colWidths=[AVAIL], rowHeights=[1],
                       style=TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.7, NAVY)])))
    story.append(Spacer(1, 5))


def heading(story, text, level=1):
    story.append(Paragraph(esc(text), S[f"h{level}"]))


def notice(story, text):
    story.append(Paragraph(esc(text), S["notice"]))


def table(story, rows):
    story.append(_table(rows))
    story.append(Spacer(1, 6))


def page_break(story):
    story.append(PageBreak())


def title_page(story, agency, doc_title, subtitle, meta_lines, warning=None):
    story.append(Spacer(1, 2.1 * inch))
    story.append(Paragraph(esc(agency), S["t_agency"]))
    story.append(Paragraph(esc(doc_title), S["t_title"]))
    story.append(Paragraph(esc(subtitle), S["t_sub"]))
    if warning:
        story.append(Paragraph(esc(warning), S["t_warn"]))
    story.append(Spacer(1, 1.1 * inch))
    for line in meta_lines:
        story.append(Paragraph(esc(line), S["t_meta"]))
    story.append(PageBreak())


def build(path, story, footer):
    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(GREY)
        canvas.drawCentredString(PAGE_W / 2, 0.34 * inch, footer)
        canvas.drawRightString(PAGE_W - MARGIN, 0.34 * inch, str(canvas.getPageNumber()))
        canvas.restoreState()

    doc = BaseDocTemplate(path, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN,
                          topMargin=MARGIN, bottomMargin=0.6 * inch, title=footer)
    frame = Frame(MARGIN, 0.6 * inch, AVAIL, PAGE_H - MARGIN - 0.6 * inch, id="f")
    doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=on_page)])
    doc.build(story)
