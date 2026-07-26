"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientFollowUpQuestion } from "@/lib/clientFollowUp";

type AnswerValue = string | string[];

type FollowUpData = {
  completed: boolean;
  provider?: { name?: string | null; phone?: string | null } | null;
  clientFirstName?: string;
  questions?: ClientFollowUpQuestion[];
  expiresAt?: string;
  savedCount?: number;
  skippedCount?: number;
};

function answered(value: AnswerValue | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : !!value?.trim();
}

function QuestionControl({
  question,
  value,
  onChange,
}: {
  question: ClientFollowUpQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const options = question.options || [];
  if (question.type === "chips") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="grid gap-2" role="group" aria-labelledby="follow-up-question-label">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <label key={option} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 text-base font-semibold ${active ? "border-brand bg-brand-light text-brand" : "border-slate-300 bg-white"}`}>
              <input
                type="checkbox"
                checked={active}
                onChange={() => onChange(active ? selected.filter((item) => item !== option) : [...selected, option])}
              />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (["radio", "yesno", "survey"].includes(question.type)) {
    const selected = typeof value === "string" ? value : "";
    return (
      <div className="grid gap-2" role="group" aria-labelledby="follow-up-question-label">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={selected === option}
            className={`min-h-14 rounded-lg border px-4 py-3 text-left text-base font-semibold ${selected === option ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-800"}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }
  if (question.type === "textarea") {
    return (
      <textarea
        className="input min-h-36 resize-y"
        aria-labelledby="follow-up-question-label"
        value={typeof value === "string" ? value : ""}
        placeholder={question.placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoFocus
      />
    );
  }
  const inputType =
    question.type === "phone" ? "tel"
      : question.type === "email" ? "email"
        : question.type === "date" ? "date"
          : question.type === "number" ? "number"
            : "text";
  return (
    <input
      className="input min-h-14"
      aria-labelledby="follow-up-question-label"
      type={inputType}
      value={typeof value === "string" ? value : ""}
      placeholder={question.placeholder}
      onChange={(event) => onChange(event.target.value)}
      autoFocus
    />
  );
}

export default function ClientFollowUpPage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<"loading" | "ready" | "error" | "done">("loading");
  const [data, setData] = useState<FollowUpData | null>(null);
  const [problem, setProblem] = useState("");
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [skippedKeys, setSkippedKeys] = useState<string[]>([]);
  const [attested, setAttested] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<{ saved: number; skipped: number } | null>(null);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const progressKey = `smart-intake-follow-up:${params.token}`;

  const load = useCallback(async () => {
    setState("loading");
    setProblem("");
    try {
      const response = await fetch(`/api/follow-up/${params.token}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setData(body);
        setProblem(body.error || "This secure link is not available.");
        setState("error");
        return;
      }
      setData(body);
      if (body.completed) {
        setCompletionSummary({
          saved: Number(body.savedCount || 0),
          skipped: Number(body.skippedCount || 0),
        });
        sessionStorage.removeItem(progressKey);
        setState("done");
        return;
      }
      try {
        const saved = JSON.parse(sessionStorage.getItem(progressKey) || "{}") as {
          answers?: Record<string, AnswerValue>;
          skippedKeys?: string[];
        };
        const allowed = new Set((body.questions || []).map((question: ClientFollowUpQuestion) => question.key));
        setAnswers(Object.fromEntries(Object.entries(saved.answers || {}).filter(([key]) => allowed.has(key))));
        setSkippedKeys((saved.skippedKeys || []).filter((key) => allowed.has(key)));
      } catch {
        setAnswers({});
        setSkippedKeys([]);
      }
      setIndex(0);
      setState("ready");
    } catch {
      setProblem("We could not open the secure questions. Check your connection and try again.");
      setState("error");
    }
  }, [params.token, progressKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (state !== "ready") return;
    try { sessionStorage.setItem(progressKey, JSON.stringify({ answers, skippedKeys })); } catch { /* optional resume support */ }
  }, [answers, progressKey, skippedKeys, state]);

  const questions = useMemo(() => data?.questions || [], [data]);
  const question = questions[Math.min(index, Math.max(questions.length - 1, 0))];
  const percent = questions.length ? Math.round(((index + 1) / questions.length) * 100) : 100;
  const enteredAnswerCount = questions.filter((item) => answered(answers[item.key])).length;

  useEffect(() => {
    if (state !== "ready") return;
    questionHeadingRef.current?.focus({ preventScroll: true });
  }, [index, state]);

  function next() {
    if (!question || (!answered(answers[question.key]) && !skippedKeys.includes(question.key))) {
      setNotice("Please answer this question or choose staff follow-up.");
      return;
    }
    setNotice("");
    setIndex((current) => Math.min(current + 1, questions.length - 1));
    window.scrollTo(0, 0);
  }

  async function submit() {
    const missing = questions.find((item) => !answered(answers[item.key]) && !skippedKeys.includes(item.key));
    if (missing) {
      setIndex(questions.indexOf(missing));
      setNotice(`Please answer or choose staff follow-up for: ${missing.label}`);
      return;
    }
    if (!attested) {
      setNotice("Please confirm that the answers you entered are accurate.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      const response = await fetch(`/api/follow-up/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, skippedKeys, attested: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(body.error || "Your answers were not saved. Please try again.");
        return;
      }
      setCompletionSummary({
        saved: Number(body.savedCount || 0),
        skipped: Number(body.skippedCount || 0),
      });
      sessionStorage.removeItem(progressKey);
      setState("done");
    } catch {
      setNotice("Your answers were not saved. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const providerName = data?.provider?.name || "Your provider";
  const providerPhone = data?.provider?.phone?.trim();

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-brand px-4 py-4 text-white">
        <div className="mx-auto max-w-xl">
          <h1 className="text-lg font-bold">{providerName}</h1>
          <p className="text-sm opacity-90">Intake follow-up</p>
        </div>
      </header>
      <div className="mx-auto max-w-xl p-4 sm:py-8">
        {state === "loading" && <p className="py-16 text-center text-slate-500">Loading your questions...</p>}

        {state === "error" && (
          <section className="card text-center" role="alert">
            <h2 className="text-xl font-bold">This link is not available</h2>
            <p className="mt-2 text-slate-600">{problem}</p>
            <div className="mt-5 grid gap-2">
              <button type="button" className="btn-primary w-full" onClick={() => { void load(); }}>Try again</button>
              {providerPhone && <a className="btn-ghost w-full" href={`tel:${providerPhone.replace(/[^\d+]/g, "")}`}>Call {providerName}</a>}
            </div>
          </section>
        )}

        {state === "done" && (
          <section className="card text-center" role="status">
            <h2 className="text-2xl font-bold text-emerald-800">
              {completionSummary ? "Your response was received" : "This follow-up is complete"}
            </h2>
            <p className="mt-3 text-slate-600">
              {completionSummary?.saved
                ? `${completionSummary.saved} answer${completionSummary.saved === 1 ? " was" : "s were"} added to your intake. `
                : completionSummary
                  ? "No answers were added; staff will confirm the items with you. "
                  : ""}
              {providerName} can now finish reviewing your intake. You may close this page.
            </p>
            {!!completionSummary?.skipped && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                {completionSummary.skipped} item{completionSummary.skipped === 1 ? " was" : "s were"} left for staff to confirm with you.
              </p>
            )}
            {providerPhone && <a className="btn-ghost mt-5 w-full" href={`tel:${providerPhone.replace(/[^\d+]/g, "")}`}>Call {providerName}</a>}
          </section>
        )}

        {state === "ready" && question && (
          <section className="card">
            <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-600">
              <span>Question {index + 1} of {questions.length}</span>
              <span>{percent}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
              role="progressbar"
              aria-label="Follow-up progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-5 text-sm font-semibold text-emerald-800">
              Hi {data?.clientFirstName || "there"}, we need {questions.length === 1 ? "one more detail" : "a few more details"}.
            </p>
            <h2
              id="follow-up-question-label"
              ref={questionHeadingRef}
              tabIndex={-1}
              className="mt-2 text-xl font-bold outline-none"
            >
              {question.label}
            </h2>
            {question.help && <p className="mt-2 text-sm text-slate-600">{question.help}</p>}
            <div className="mt-5">
              {skippedKeys.includes(question.key) ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
                  <p className="font-semibold">Staff will confirm this answer with you.</p>
                  <button
                    type="button"
                    className="mt-2 text-sm font-semibold underline"
                    onClick={() => setSkippedKeys((current) => current.filter((key) => key !== question.key))}
                  >
                    Enter an answer instead
                  </button>
                </div>
              ) : (
                <QuestionControl
                  question={question}
                  value={answers[question.key]}
                  onChange={(value) => {
                    setAnswers((current) => ({ ...current, [question.key]: value }));
                    setSkippedKeys((current) => current.filter((key) => key !== question.key));
                    setNotice("");
                  }}
                />
              )}
              {!skippedKeys.includes(question.key) && (
                <button
                  type="button"
                  className="btn-ghost mt-3 w-full text-sm"
                  onClick={() => {
                    setAnswers((current) => Object.fromEntries(
                      Object.entries(current).filter(([key]) => key !== question.key),
                    ));
                    setSkippedKeys((current) => [...new Set([...current, question.key])]);
                    setNotice("");
                    if (index < questions.length - 1) {
                      setIndex((current) => current + 1);
                      window.scrollTo(0, 0);
                    }
                  }}
                >
                  I don&apos;t know - staff can confirm with me
                </button>
              )}
            </div>
            {notice && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{notice}</p>}
            {index === questions.length - 1 && (
              <label className="mt-5 flex items-start gap-3 rounded-lg border border-slate-300 bg-white p-4 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5"
                  checked={attested}
                  onChange={(event) => {
                    setAttested(event.target.checked);
                    setNotice("");
                  }}
                />
                <span>
                  {enteredAnswerCount
                    ? `I confirm the ${enteredAnswerCount === 1 ? "answer" : "answers"} I entered ${enteredAnswerCount === 1 ? "is" : "are"} accurate${skippedKeys.length ? " and the skipped items need staff follow-up" : ""}.`
                    : "I confirm these items need staff follow-up."}
                </span>
              </label>
            )}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="btn-ghost w-full disabled:opacity-40"
                disabled={index === 0 || submitting}
                onClick={() => {
                  setNotice("");
                  setIndex((current) => Math.max(0, current - 1));
                  window.scrollTo(0, 0);
                }}
              >
                Back
              </button>
              {index < questions.length - 1 ? (
                <button type="button" className="btn-primary w-full" onClick={next}>Next</button>
              ) : (
                <button type="button" className="btn-primary w-full disabled:opacity-60" disabled={submitting || !attested} onClick={() => { void submit(); }}>
                  {submitting ? "Sending..." : enteredAnswerCount ? "Send answers" : "Send response"}
                </button>
              )}
            </div>
            <p className="mt-4 text-center text-xs text-slate-500">This private link closes after your answers are sent.</p>
          </section>
        )}
      </div>
    </main>
  );
}
