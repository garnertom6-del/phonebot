/**
 * Keyboard and screen-reader coverage for the client SMS intake, checked at
 * the exact phone the flow is designed for: 390 x 844 (iPhone 14/15).
 *
 * These render the real components with react-dom/server and assert the
 * accessibility contract on the produced markup, so they run in `npm test`
 * with no browser and no flaky driver. What they protect:
 *   - every control a client can reach has an accessible name
 *   - focus order is DOM order (no positive tabindex, nothing focus-trapped)
 *   - tap targets clear 44px, the minimum for a thumb on a 390px screen
 *   - state changes (saved, missing answer, submit failure) are announced
 *   - nothing is wider than the 390px viewport
 *
 * Run inside `npm test`; needs scripts/tsconfig.a11y.json for the automatic
 * JSX runtime, because tsx defaults to the classic one.
 */
import assert from "assert";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerWidget } from "../src/components/EasyQuestionnaire";
import ProgressBar from "../src/components/ProgressBar";
import { SECTIONS, type Question } from "../src/config/mooreDivineQuestions";

/** The viewport this flow is built for. */
export const CLIENT_VIEWPORT = { width: 390, height: 844 } as const;
/** Tailwind p-4 on the page container: 16px each side. */
const PAGE_PADDING = 16;
const CONTENT_WIDTH = CLIENT_VIEWPORT.width - PAGE_PADDING * 2; // 358px
/** WCAG 2.5.5 / Apple HIG minimum thumb target. */
const MIN_TAP_TARGET = 44;

let passed = 0;
const ok = (m: string) => { passed++; console.log("  ✓", m); };

const render = (q: Question, value?: unknown) => renderToStaticMarkup(
  <AnswerWidget
    q={q} value={value as never} justPicked={null}
    set={() => {}} pickAndAdvance={() => {}} onNext={async () => {}}
    providerName="Moore Divine Care, Inc." providerPhone="336-285-5204" />,
);

const tags = (html: string, tag: string): string[] =>
  html.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) || [];
const attr = (openTag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(openTag);
  return m ? m[1] : null;
};
/** Text between an opening tag and its close - enough for a button label. */
const textAfter = (html: string, openTag: string): string => {
  const start = html.indexOf(openTag) + openTag.length;
  const end = html.indexOf("<", start);
  return html.slice(start, end < 0 ? undefined : end).replace(/\s+/g, " ").trim();
};

/** Every client-visible question, one of each shape. */
const clientQuestions: Question[] = [];
for (const s of SECTIONS) {
  for (const q of s.questions) {
    if (q.staffOnly || q.type === "info" || q.type === "heading") continue;
    clientQuestions.push(q);
  }
}

export async function runA11yChecks() {
  console.log(`\nClient flow accessibility at ${CLIENT_VIEWPORT.width}x${CLIENT_VIEWPORT.height}`);
  // render each question once; the checks below all read the same markup
  const rendered = new Map<string, string>();
  for (const q of clientQuestions) rendered.set(q.key, render(q));
  const htmlFor = (q: Question) => rendered.get(q.key)!;

  // ---- 1. every control carries an accessible name ------------------------
  {
    const unnamed: string[] = [];
    for (const q of clientQuestions) {
      const html = htmlFor(q);
      for (const t of [...tags(html, "button"), ...tags(html, "select"), ...tags(html, "textarea"), ...tags(html, "input")]) {
        const named = attr(t, "aria-label") || attr(t, "aria-labelledby") || attr(t, "title");
        const label = textAfter(html, t);
        if (!named && !label) unnamed.push(`${q.key}: ${t.slice(0, 70)}`);
      }
    }
    assert.deepEqual(unnamed, [], `controls with no accessible name:\n    ${unnamed.join("\n    ")}`);
    ok(`every control across ${clientQuestions.length} client questions has an accessible name`);
  }

  // ---- 2. focus order is DOM order ----------------------------------------
  {
    const positive: string[] = [];
    for (const q of clientQuestions) {
      const html = htmlFor(q);
      for (const t of html.match(/<[^>]*tabindex="[^"]*"[^>]*>/g) || []) {
        const value = Number(attr(t, "tabindex"));
        if (value > 0) positive.push(`${q.key}: tabindex=${value}`);
      }
    }
    assert.deepEqual(positive, [],
      `a positive tabindex breaks keyboard order on a phone: ${positive.join(", ")}`);
    ok("no positive tabindex - Tab order follows reading order");
  }

  // ---- 3. tap targets clear 44px ------------------------------------------
  {
    const small: string[] = [];
    for (const q of clientQuestions) {
      const html = htmlFor(q);
      for (const t of [...tags(html, "button"), ...tags(html, "select")]) {
        const cls = attr(t, "class") || "";
        const m = /min-h-\[(\d+)px\]/.exec(cls);
        const height = m ? Number(m[1]) : null;
        // <summary> style disclosures and inline links are not primary targets
        if (height === null) { small.push(`${q.key}: no explicit min height on ${t.slice(0, 50)}`); continue; }
        if (height < MIN_TAP_TARGET) small.push(`${q.key}: ${height}px target`);
      }
    }
    assert.deepEqual(small, [], `tap targets under ${MIN_TAP_TARGET}px:\n    ${small.join("\n    ")}`);
    ok(`every option and control is at least ${MIN_TAP_TARGET}px tall`);
  }

  // ---- 4. choice buttons report their pressed state -----------------------
  {
    const radio = clientQuestions.find((q) => q.type === "radio" && (q.options?.length || 0) <= 4);
    assert(radio, "expected at least one short radio question");
    const html = render(radio!, radio!.options![0]);
    const buttons = tags(html, "button");
    assert.ok(buttons.length > 0, "a radio question renders option buttons");
    assert.ok(buttons.every((b) => attr(b, "aria-pressed") !== null),
      "every option button exposes aria-pressed so its state is readable");
    assert.equal(attr(buttons[0], "aria-pressed"), "true", "the chosen option reads as pressed");
    assert.equal(attr(buttons[1], "aria-pressed"), "false", "the others read as not pressed");
    ok("choice buttons announce which answer is selected");
  }

  // ---- 5. long menus stay reachable and named -----------------------------
  {
    const menu = clientQuestions.find((q) => (q.type === "radio" || q.type === "yesno") && (q.options?.length || 0) > 4);
    assert(menu, "expected at least one long menu question");
    const html = render(menu!);
    const select = tags(html, "select")[0];
    assert(select, "a long option list renders a native select, which phone screen readers handle");
    assert.ok(attr(select, "aria-label"), "the select carries the question as its accessible name");
    ok("long answer lists use a native menu with the question as its label");
  }

  // ---- 6. consent text is reachable, not hidden behind a mouse hover -------
  {
    const consent = clientQuestions.find((q) => q.type === "consent" && !!q.consentText);
    assert(consent, "expected a consent question");
    const html = render(consent!);
    assert.ok(html.includes("<details"), "the full legal text sits in a <details>, which opens from the keyboard");
    assert.ok(html.includes("<summary"), "the disclosure has a focusable summary");
    assert.ok((consent!.consentText || "").length > 0 && html.includes((consent!.consentText || "").slice(0, 40)),
      "the complete consent text is present in the markup, not fetched on hover");
    ok("consent text opens from the keyboard and is fully present");
  }

  // ---- 7. progress is exposed to assistive tech ---------------------------
  {
    const html = renderToStaticMarkup(<ProgressBar percent={42} label="Question 20 of 48 - 42% done" />);
    const bar = tags(html, "div").find((t) => attr(t, "role") === "progressbar");
    assert(bar, "the progress bar exposes role=progressbar");
    assert.equal(attr(bar!, "aria-valuenow"), "42", "progress reports its current value");
    assert.equal(attr(bar!, "aria-valuemin"), "0");
    assert.equal(attr(bar!, "aria-valuemax"), "100");
    assert.ok(attr(bar!, "aria-label"), "the progress bar names what it is measuring");
    ok("progress is announced, not only drawn");
  }

  // ---- 8. nothing is wider than the phone ---------------------------------
  {
    const tooWide: string[] = [];
    for (const q of clientQuestions) {
      const html = htmlFor(q);
      for (const t of html.match(/<[^>]*class="[^"]*"[^>]*>/g) || []) {
        const cls = attr(t, "class") || "";
        for (const m of cls.matchAll(/\bw-\[(\d+)px\]|\bmin-w-\[(\d+)px\]/g)) {
          const px = Number(m[1] ?? m[2]);
          if (px > CONTENT_WIDTH) tooWide.push(`${q.key}: ${px}px inside a ${CONTENT_WIDTH}px column`);
        }
      }
      assert.ok(!/\boverflow-x-(?:visible|scroll)\b/.test(html), `${q.key} must not scroll sideways on a phone`);
    }
    assert.deepEqual(tooWide, [],
      `content wider than the ${CLIENT_VIEWPORT.width}px viewport:\n    ${tooWide.join("\n    ")}`);
    ok(`no question is wider than the ${CONTENT_WIDTH}px content column at ${CLIENT_VIEWPORT.width}px`);
  }

  // ---- 9. state changes are announced -------------------------------------
  {
    const source = (await import("node:fs")).readFileSync(
      new URL("../src/components/EasyQuestionnaire.tsx", import.meta.url), "utf8");
    assert.ok(/role="status"\s+aria-live="polite"/.test(source),
      "save status must sit in a permanent polite live region, or a screen-reader client never hears it saved");
    assert.ok(/<p role="alert"/.test(source),
      "the missing-answer nudge must be an alert, or the client is stuck with no idea why Next did nothing");
    assert.ok(/<div role="alert"/.test(source),
      "the submit failure must be an alert");
    ok("saved, missing-answer and submit-failure states are all announced");
  }

  console.log(`  ${passed} accessibility checks passed`);
  return passed;
}
