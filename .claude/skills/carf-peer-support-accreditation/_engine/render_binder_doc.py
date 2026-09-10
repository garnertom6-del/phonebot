"""Render one client binder Markdown document to PDF.

Every binder document under providers/<slug>/binder/ has the same shape: two H1 lines
(the binder banner, then the document title), then the body. This turns one of those
into a PDF with a title page, a running footer, and the DRAFT stamp that stays on until
the agency signs the document.

Usage:
    python3 _engine/render_binder_doc.py <path/to/DOC.md> \
        --id MTG-01 \
        --subtitle "Reusable template" \
        [--status "DRAFT, not yet adopted"] \
        [--warning "..."] \
        [--meta "line" --meta "line"]

The title, agency and body all come from the Markdown, so the two files cannot drift.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdf_kit as P  # noqa: E402


def split_front(md):
    """Return (agency banner, document title, body) from a binder Markdown file."""
    lines = md.split("\n")
    heads = []
    i = 0
    while i < len(lines) and len(heads) < 2:
        s = lines[i].strip()
        if s.startswith("# "):
            heads.append(s[2:].strip())
        elif s:
            break
        i += 1
    if len(heads) < 2:
        raise SystemExit("expected two '# ' heading lines at the top of the document")
    return heads[0], heads[1], "\n".join(lines[i:])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("md")
    ap.add_argument("--id", required=True, help="document ID, e.g. MTG-01")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--status", default="DRAFT, not yet adopted")
    ap.add_argument("--warning", default=None)
    ap.add_argument("--meta", action="append", default=[])
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    with open(a.md, encoding="utf-8") as fh:
        banner, title, body = split_front(fh.read())

    agency = banner.split("|")[0].strip()
    out = a.out or os.path.splitext(a.md)[0] + ".pdf"
    footer = f"{agency} — {a.id} — {a.status}"

    story = []
    P.title_page(story, agency, title, a.subtitle or banner, a.meta, warning=a.warning)
    P.render_markdown(story, body)
    P.build(out, story, footer)
    print(out)


if __name__ == "__main__":
    main()
