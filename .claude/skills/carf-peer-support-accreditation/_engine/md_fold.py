"""Fold wrapped Markdown source lines back into whole paragraphs.

Both renderers treat one source line as one paragraph. That is deliberate: forms in this
packet use consecutive short lines as separate fields, and reflowing them would run
"Signature: ____" and "Date: ____" together on one line.

Two cases must still be folded, because leaving them alone produces visibly wrong output:

1. An indented continuation line belonging to the list item above it. Left alone it prints
   flush against the left margin, outside its own numbered item.
2. A line that ends in the middle of a **bold span**. The span opens on one line and closes
   on the next, so neither line is valid on its own and the asterisks print literally.

Anything else is left exactly as written.
"""
import re

LIST_RE = re.compile(r"^(?:[-*]\s+|\d+\.\s+)")


def _structural(stripped):
    return (not stripped
            or stripped.startswith("|")
            or stripped.startswith("#")
            or stripped.startswith(">")
            or stripped in ("---", "***", "___"))


def fold(md):
    out = []
    buf = None
    for raw in md.split("\n"):
        stripped = raw.strip()
        indented = raw[:1] == " " and raw[:2].strip() == ""
        joinable = buf is not None and not _structural(stripped) and not LIST_RE.match(stripped)

        if joinable and (indented or buf.count("**") % 2):
            buf = f"{buf} {stripped}"
            continue

        if buf is not None:
            out.append(buf)
            buf = None

        if _structural(stripped):
            out.append(raw)
        else:
            buf = stripped

    if buf is not None:
        out.append(buf)
    return "\n".join(out)
