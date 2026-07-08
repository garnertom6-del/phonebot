/**
 * PLACEHOLDER - a coworker is writing the full 5th-grade-reading-level copy.
 * Shape must stay exactly like this so EasyQuestionnaire.tsx keeps compiling.
 */

export interface EasyText {
  q: string;
  help?: string;
  options?: Record<string, string>;
  consentSimple?: string;
}

export const EASY: Record<string, EasyText> = {};

export const SECTION_INTROS: Record<string, string> = {};

export const ENCOURAGEMENTS: string[] = [];
