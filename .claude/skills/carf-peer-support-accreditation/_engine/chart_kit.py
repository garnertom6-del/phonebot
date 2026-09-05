"""Charts for the CARF performance analysis report.

Static PNGs for a printed document, so there is no hover layer and no dark mode -
the print surface is the only surface. Everything else follows the house rules:
one axis per chart (never two scales), a legend whenever there are 2+ series with
direct labels on top, categorical hues assigned in fixed order and never cycled,
status colors reserved and always paired with a text label, and a recessive grid.

Palette: the validated default. Slots 1-3 clear the all-pairs gates in light mode
(worst CVD dE 9.2, normal-vision 24.0). Slot 3 (aqua) sits under 3:1 against the
surface, so the relief rule applies - every series here carries a direct label.
Past three series we facet or fold to "Other" rather than inventing a 4th hue.
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#8a8880"
GRID = "#e6e5e0"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]          # fixed order, never cycled
STATUS = {"good": "#0ca30c", "warning": "#fab219",
          "serious": "#ec835a", "critical": "#d03b3b"}

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9,
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE, "text.color": INK,
    "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "axes.edgecolor": GRID, "axes.linewidth": 0.8,
})


def _finish(ax, title, subtitle=None, ylabel=None):
    ax.set_title(title, fontsize=11, fontweight="bold", color=INK, loc="left",
                 pad=16 if subtitle else 8)
    if subtitle:
        ax.text(0, 1.02, subtitle, transform=ax.transAxes, fontsize=8.5, color=INK2, va="bottom")
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=8.5)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(GRID)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(length=0)


def _save(fig, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=200, bbox_inches="tight", pad_inches=0.18)
    plt.close(fig)
    return path


def trend(path, periods, series, title, subtitle=None, target=None, ylabel=None,
          target_label="Target", lower_is_better=False):
    """Change over time. series = {name: [values, None where missing]}. Max 3 series."""
    fig, ax = plt.subplots(figsize=(7.1, 3.0))
    names = list(series)[:3]
    gaps = []
    for i, name in enumerate(names):
        vals = series[name]
        # Plot with NaN gaps so a quarter with no data reads as a BREAK in the line,
        # not as a straight line through it. Inventing the shape of missing data is
        # exactly the thing this whole packet refuses to do.
        ys = [float("nan") if v is None else v for v in vals]
        if all(v != v for v in ys):
            continue
        ax.plot(range(len(ys)), ys, color=SERIES[i], linewidth=2, marker="o", markersize=6,
                markeredgecolor=SURFACE, markeredgewidth=1.6, label=name, zorder=3)
        last = max((j for j, v in enumerate(vals) if v is not None), default=None)
        if last is not None:
            ax.annotate(f"{vals[last]:g}", (last, vals[last]), textcoords="offset points",
                        xytext=(7, 4), fontsize=8.5, color=INK, fontweight="bold")
        gaps += [periods[j] for j, v in enumerate(vals) if v is None]
    if target is not None:
        ax.axhline(target, color=MUTED, linewidth=1.2, linestyle=(0, (5, 4)), zorder=1)
        # Label the reference line on the LEFT so it never collides with the
        # last-value label on the right.
        ax.annotate(f"{target_label} {target:g}", (0, target), textcoords="offset points",
                    xytext=(0, 6), fontsize=8, color=INK2, ha="left")
    if gaps:
        ax.text(0, -0.30, "No data entered for: " + ", ".join(sorted(set(gaps))),
                transform=ax.transAxes, fontsize=8, color=MUTED, va="top")
    ax.set_xticks(range(len(periods)))
    ax.set_xticklabels(periods, fontsize=8.5)
    ax.set_xlim(-0.35, len(periods) - 0.25)
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    if len(names) > 1:
        ax.legend(frameon=False, fontsize=8.5, loc="upper left",
                  bbox_to_anchor=(0, -0.16 - (0.10 if gaps else 0)), ncol=len(names))
    _finish(ax, title, subtitle, ylabel)
    if lower_is_better:
        ax.text(1, 1.02, "lower is better", transform=ax.transAxes, fontsize=8,
                color=MUTED, ha="right", va="bottom")
    return _save(fig, path)


def ranked_bar(path, labels, values, title, subtitle=None, xlabel=None, color=SERIES[0], top=12):
    """Magnitude, ranked. Horizontal so long labels stay readable."""
    pairs = sorted(zip(labels, values), key=lambda p: p[1], reverse=True)[:top]
    pairs.reverse()
    labs = [p[0] for p in pairs]
    vals = [p[1] for p in pairs]
    fig, ax = plt.subplots(figsize=(7.1, max(1.9, 0.32 * len(labs) + 1.1)))
    bars = ax.barh(range(len(labs)), vals, color=color, height=0.62, zorder=3)
    for b, v in zip(bars, vals):
        ax.annotate(f"{v:g}", (b.get_width(), b.get_y() + b.get_height() / 2),
                    textcoords="offset points", xytext=(5, 0), va="center",
                    fontsize=8.5, color=INK, fontweight="bold")
    ax.set_yticks(range(len(labs)))
    ax.set_yticklabels(labs, fontsize=8.5)
    ax.set_xlim(0, max(vals + [1]) * 1.18)
    ax.grid(axis="x", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=8.5)
    _finish(ax, title, subtitle)
    return _save(fig, path)


def grouped_bar(path, groups, series, title, subtitle=None, ylabel=None, target=None):
    """Up to 3 series across groups, with a surface gap between adjacent fills."""
    names = list(series)[:3]
    n = len(names)
    fig, ax = plt.subplots(figsize=(7.1, 3.0))
    width = 0.80 / max(n, 1)
    for i, name in enumerate(names):
        xs = [g + (i - (n - 1) / 2) * width for g in range(len(groups))]
        vals = series[name]
        ax.bar(xs, vals, width=width * 0.92, color=SERIES[i], label=name,
               zorder=3, edgecolor=SURFACE, linewidth=1.2)
        for x, v in zip(xs, vals):
            if v:
                ax.annotate(f"{v:g}", (x, v), textcoords="offset points", xytext=(0, 3),
                            ha="center", fontsize=7.8, color=INK)
    if target is not None:
        ax.axhline(target, color=MUTED, linewidth=1.2, linestyle=(0, (5, 4)), zorder=1)
        # Left-anchored so it never collides with the right-most value label.
        ax.annotate(f"Target {target:g}", (-0.45, target), textcoords="offset points",
                    xytext=(0, 6), fontsize=8, color=INK2, ha="left")
    ax.set_xticks(range(len(groups)))
    ax.set_xticklabels(groups, fontsize=8.5)
    ax.set_xlim(-0.55, len(groups) - 0.45)
    ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    if n > 1:
        ax.legend(frameon=False, fontsize=8.5, loc="upper left",
                  bbox_to_anchor=(0, -0.16), ncol=n)
    _finish(ax, title, subtitle, ylabel)
    return _save(fig, path)


def status_bar(path, counts, title, subtitle=None):
    """One stacked bar in the reserved status colors, every band labelled in words."""
    order = [("Complete", "good"), ("Upcoming", "warning"),
             ("Due within 30 days", "serious"), ("OVERDUE", "critical")]
    data = [(lab, counts.get(lab, 0), STATUS[key]) for lab, key in order]
    total = sum(d[1] for d in data) or 1
    fig, ax = plt.subplots(figsize=(7.1, 1.7))
    left = 0
    for lab, val, col in data:
        if not val:
            continue
        ax.barh([0], [val], left=left, color=col, height=0.5, zorder=3,
                edgecolor=SURFACE, linewidth=1.6)
        if val / total > 0.06:
            ax.annotate(f"{lab}\n{val}", (left + val / 2, 0), ha="center", va="center",
                        fontsize=8.5, color=INK if col == STATUS["warning"] else "#ffffff",
                        fontweight="bold")
        left += val
    ax.set_xlim(0, total)
    ax.set_ylim(-0.5, 0.5)
    ax.set_yticks([])
    ax.set_xlabel("Required items", fontsize=8.5)
    handles = [plt.Rectangle((0, 0), 1, 1, color=c) for _, v, c in data if v]
    labels = [f"{lab} ({v})" for lab, v, c in data if v]
    ax.legend(handles, labels, frameon=False, fontsize=8.5, loc="upper left",
              bbox_to_anchor=(0, -0.42), ncol=4)
    _finish(ax, title, subtitle)
    ax.spines["left"].set_visible(False)
    return _save(fig, path)


def paired_change(path, labels, before, after, title, subtitle=None,
                  before_label="At admission", after_label="At last review", ylabel=None):
    """The before/after question as two labelled series, never two y-scales."""
    return grouped_bar(path, labels, {before_label: before, after_label: after},
                       title, subtitle, ylabel)
