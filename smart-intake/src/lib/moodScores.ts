/**
 * PHQ-9 (depression) and GAD-7 (anxiety) auto-scoring. Both instruments are
 * public domain. Scores are computed from the stored option text using the
 * standard 0-3 frequency scale and shown to staff with the standard severity
 * bands - they inform, they do not diagnose.
 */
import { MOOD_FREQ } from "@/config/mooreDivineQuestions";

export interface MoodScore {
  score: number;
  answered: number;
  total: number;
  severity: string;
  flag: boolean; // needs clinical attention (moderate+ or self-harm item endorsed)
}

export interface MoodScores {
  phq9?: MoodScore;
  gad7?: MoodScore;
  selfHarmEndorsed: boolean; // PHQ-9 item 9 > "Not at all"
}

function value(answers: Record<string, unknown>, key: string): number | null {
  const idx = (MOOD_FREQ as readonly string[]).indexOf(String(answers[key] ?? ""));
  return idx >= 0 ? idx : null;
}

function sum(answers: Record<string, unknown>, prefix: string, count: number) {
  let score = 0, answered = 0;
  for (let i = 1; i <= count; i++) {
    const v = value(answers, `${prefix}_q${i}`);
    if (v !== null) { score += v; answered++; }
  }
  return { score, answered };
}

function phqSeverity(score: number): string {
  if (score >= 20) return "severe depression range";
  if (score >= 15) return "moderately severe range";
  if (score >= 10) return "moderate range";
  if (score >= 5) return "mild range";
  return "minimal range";
}

function gadSeverity(score: number): string {
  if (score >= 15) return "severe anxiety range";
  if (score >= 10) return "moderate range";
  if (score >= 5) return "mild range";
  return "minimal range";
}

export function moodScores(answers: Record<string, unknown>): MoodScores {
  const phq = sum(answers, "phq9", 9);
  const gad = sum(answers, "gad7", 7);
  const q9 = value(answers, "phq9_q9");
  const selfHarmEndorsed = (q9 ?? 0) > 0;
  const out: MoodScores = { selfHarmEndorsed };
  if (phq.answered > 0) {
    out.phq9 = {
      score: phq.score, answered: phq.answered, total: 9,
      severity: phqSeverity(phq.score),
      flag: phq.score >= 10 || selfHarmEndorsed,
    };
  }
  if (gad.answered > 0) {
    out.gad7 = {
      score: gad.score, answered: gad.answered, total: 7,
      severity: gadSeverity(gad.score),
      flag: gad.score >= 10,
    };
  }
  return out;
}
