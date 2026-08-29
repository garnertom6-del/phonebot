import type { Answers } from "./fillPdf";

type InsurancePlanMap = {
  key: string;
  aliases: string[];
  providerChoice: string;
  mco?: string;
};

const INSURANCE_PLAN_MAP: InsurancePlanMap[] = [
  { key: "amerihealth", aliases: ["amerihealth"], providerChoice: "AmeriHealth", mco: "AmeriHealth" },
  { key: "alliance", aliases: ["alliance"], providerChoice: "Alliance", mco: "Alliance" },
  { key: "bcbs", aliases: ["bcbs", "blue cross", "blue cross blue shield"], providerChoice: "Blue Cross Blue Shield" },
  { key: "partners", aliases: ["partners", "partners bh", "partners behavioral health"], providerChoice: "Partners Behavioral Health", mco: "Partners BH" },
  { key: "carolina-complete", aliases: ["carolina complete"], providerChoice: "Carolina Complete", mco: "Carolina Complete" },
  { key: "trillium", aliases: ["trillium", "sandhills center", "sandhills center/trillium"], providerChoice: "Sandhills Center/Trillium", mco: "Trillium" },
  { key: "healthy-blue", aliases: ["healthy blue", "healthy blue medicaid"], providerChoice: "Healthy Blue", mco: "Healthy Blue Medicaid" },
  { key: "vaya", aliases: ["vaya"], providerChoice: "Vaya", mco: "Vaya" },
  { key: "medicaid", aliases: ["medicaid"], providerChoice: "Medicaid" },
  { key: "united", aliases: ["united", "united health care", "united healthcare"], providerChoice: "United Health Care", mco: "United Healthcare" },
  { key: "wellcare", aliases: ["wellcare"], providerChoice: "Wellcare", mco: "Wellcare" },
  { key: "not-sure", aliases: ["not sure", "unknown"], providerChoice: "Not sure", mco: "Not sure" },
];

const RECORD_NUMBER_PREFIXES: Record<string, string> = {
  amerihealth: "AMERI",
  alliance: "ALL",
  bcbs: "BCBS",
  partners: "PART",
  "carolina-complete": "CC",
  trillium: "TRI",
  "healthy-blue": "HB",
  vaya: "VAYA",
  medicaid: "MED",
  united: "UHC",
  wellcare: "WELL",
  "not-sure": "OTHER",
};

const LOOKUP_ONLY_RECORD_NUMBER_KEYS = new Set(["partners", "vaya", "alliance", "trillium"]);
const GENERATOR_RECORD_NUMBER_KEYS = new Set(["bcbs", "united", "amerihealth", "carolina-complete"]);

/**
 * Where staff actually sign in to find a member's record for the lookup-only
 * plans. Verified against each MCO's own provider site on 2026-08-29:
 *  - Alliance: providerportal.alliancehealthplan.org is the single sign-on
 *    front door to the Alliance Claims System (ACS) and other provider apps.
 *  - Trillium: Provider Direct (behavioral health / I/DD) uses the Dashboard
 *    sign-in at ncinno.org.
 *  - Vaya: providerportal.vayahealth.com (claims, authorizations, users).
 *  - Partners: ProviderCONNECT signs in at id.partnersbhm.org; each agency's
 *    local administrator provisions its users.
 * These are not directories - a member lookup needs the agency's own login.
 */
export const RECORD_NUMBER_LOOKUP_LINKS = [
  {
    key: "partners",
    label: "Partners",
    portal: "ProviderCONNECT",
    url: "https://id.partnersbhm.org/",
    description: "Partners ProviderCONNECT sign-in. Your agency's ProviderCONNECT local administrator must provision your account before you can log in.",
  },
  {
    key: "vaya",
    label: "Vaya",
    portal: "Vaya Provider Portal",
    url: "https://providerportal.vayahealth.com/",
    description: "Vaya Health Provider Portal sign-in (claims, authorizations, member information).",
  },
  {
    key: "alliance",
    label: "Alliance",
    portal: "Alliance Provider Portal (ACS)",
    url: "https://providerportal.alliancehealthplan.org/",
    description: "Alliance Health Provider Portal - single sign-on to the Alliance Claims System (ACS). Access is requested through Alliance's ACS access form.",
  },
  {
    key: "trillium",
    label: "Trillium",
    portal: "Provider Direct",
    url: "https://www.ncinno.org/Dashboard",
    description: "Trillium Provider Direct dashboard sign-in for behavioral health and I/DD providers.",
  },
] as const;

export const PROVIDER_CHOICE_PLAN_OPTIONS = INSURANCE_PLAN_MAP.map((item) => item.providerChoice);

export const RECORD_NUMBER_GENERATOR_PLAN_OPTIONS = INSURANCE_PLAN_MAP
  .filter((item) => GENERATOR_RECORD_NUMBER_KEYS.has(item.key))
  .map((item) => item.providerChoice);

export const RECORD_NUMBER_LOOKUP_PLAN_OPTIONS = INSURANCE_PLAN_MAP
  .filter((item) => LOOKUP_ONLY_RECORD_NUMBER_KEYS.has(item.key))
  .map((item) => item.providerChoice);

/** Plans with no dedicated generator or lookup here; staff may type the official Record#. */
export const RECORD_NUMBER_MANUAL_PLAN_OPTIONS = INSURANCE_PLAN_MAP
  .filter((item) => !GENERATOR_RECORD_NUMBER_KEYS.has(item.key) && !LOOKUP_ONLY_RECORD_NUMBER_KEYS.has(item.key))
  .map((item) => item.providerChoice);

/**
 * The one insurance dropdown on the Create Intake page, grouped by what happens
 * to the Record#. Every plan in PROVIDER_CHOICE_PLAN_OPTIONS appears in exactly
 * one group (checked by scripts/test.ts).
 */
export const RECORD_NUMBER_PLAN_GROUPS: ReadonlyArray<{ label: string; plans: string[] }> = [
  { label: "Generates a Record# for you", plans: RECORD_NUMBER_GENERATOR_PLAN_OPTIONS },
  { label: "Sign in to the plan's provider portal for the Record#", plans: RECORD_NUMBER_LOOKUP_PLAN_OPTIONS },
  { label: "Type the official Record# or use a temporary one", plans: RECORD_NUMBER_MANUAL_PLAN_OPTIONS },
];

export type RecordNumberMode = "generate" | "lookup" | "manual";

/** How the Record# is obtained for a plan; "" when no known plan is chosen. */
export function recordNumberMode(value: string): RecordNumberMode | "" {
  const plan = matchingPlan(value);
  if (!plan) return "";
  if (GENERATOR_RECORD_NUMBER_KEYS.has(plan.key)) return "generate";
  if (LOOKUP_ONLY_RECORD_NUMBER_KEYS.has(plan.key)) return "lookup";
  return "manual";
}

/** The official lookup site for a lookup-only plan, or null for every other plan. */
export function recordNumberLookupLink(value: string): (typeof RECORD_NUMBER_LOOKUP_LINKS)[number] | null {
  const plan = matchingPlan(value);
  if (!plan) return null;
  return RECORD_NUMBER_LOOKUP_LINKS.find((link) => link.key === plan.key) || null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchingPlan(value: string): InsurancePlanMap | undefined {
  const key = normalizedKey(value);
  if (!key) return undefined;
  return INSURANCE_PLAN_MAP.find((plan) =>
    plan.aliases.some((alias) => {
      const normalizedAlias = normalizedKey(alias);
      return key === normalizedAlias || key.includes(normalizedAlias);
    }));
}

export function recordNumberPrefix(value: string): string {
  const plan = matchingPlan(value);
  return plan ? RECORD_NUMBER_PREFIXES[plan.key] || "OTHER" : "";
}

export function canGenerateRecordNumber(value: string): boolean {
  const plan = matchingPlan(value);
  return !!plan && GENERATOR_RECORD_NUMBER_KEYS.has(plan.key);
}

export function isLookupOnlyRecordNumberPlan(value: string): boolean {
  const plan = matchingPlan(value);
  return !!plan && LOOKUP_ONLY_RECORD_NUMBER_KEYS.has(plan.key);
}

/**
 * Record# is optional on Create New Intake. A lookup-only panel still needs
 * the official number. Otherwise the server generates TEMP- or panel-prefixed
 * digits so staff are not blocked by Advanced.
 */
export function resolveCreateRecordNumber(
  recordNumber?: string,
  providerChoicePlan?: string,
): { recordNumber: string; shouldGenerate: boolean; error?: string } {
  const existing = text(recordNumber);
  if (existing) return { recordNumber: existing, shouldGenerate: false };
  const panel = text(providerChoicePlan);
  if (panel && isLookupOnlyRecordNumberPlan(panel)) {
    return {
      recordNumber: "",
      shouldGenerate: false,
      error: "Enter the panel's official Record# manually. Only BCBS, United Health Care, AmeriHealth, and Carolina Complete use the generator.",
    };
  }
  return { recordNumber: "", shouldGenerate: true };
}

export function makeRecordNumber(value: string, random: () => number = Math.random): string {
  const prefix = recordNumberPrefix(value) || "TEMP";
  const safeRandom = Math.min(0.999999, Math.max(0, random()));
  const digits = 10000 + Math.floor(safeRandom * 90000);
  return `${prefix}-${digits}`;
}

export function normalizeInsuranceValue(value: string, target: "providerChoice" | "mco"): string {
  const cleaned = text(value);
  if (!cleaned) return "";
  const plan = matchingPlan(cleaned);
  if (!plan) return cleaned;
  return target === "providerChoice" ? plan.providerChoice : (plan.mco || "");
}

export function applyInsurancePlanDefaults(a: Answers) {
  const providerChoice = text(a.provider_choice_plan);
  const mco = text(a.mco);
  // Staff-set insurance type on the dashboard should control the packet-facing
  // insurance fields, even if an older MCO value is already present.
  if (providerChoice) {
    const normalizedProviderChoice = normalizeInsuranceValue(providerChoice, "providerChoice") || providerChoice;
    a.provider_choice_plan = normalizedProviderChoice;
    const normalizedMco = normalizeInsuranceValue(normalizedProviderChoice, "mco");
    a.mco = normalizedMco || "";
  } else if (mco) {
    const normalizedProviderChoice = normalizeInsuranceValue(mco, "providerChoice");
    if (normalizedProviderChoice) a.provider_choice_plan = normalizedProviderChoice;
    a.mco = normalizeInsuranceValue(mco, "mco") || mco;
  }
  const confirmedCoverage = matchingPlan(text(a.provider_choice_plan) || text(a.mco));
  if (!text(a.has_medicaid) && confirmedCoverage && confirmedCoverage.key !== "bcbs" && confirmedCoverage.key !== "not-sure") {
    a.has_medicaid = "Yes";
  }
}

export function insuranceSummary(answers: Record<string, unknown>): string {
  const parts: string[] = [];
  if (text(answers.has_medicaid) === "Yes") parts.push("Medicaid");
  if (text(answers.has_nchc) === "Yes") parts.push("NCHC");
  const plan = text(answers.provider_choice_plan) && text(answers.provider_choice_plan) !== "Not sure"
    ? text(answers.provider_choice_plan)
    : text(answers.mco);
  if (plan && plan !== "Not sure" && !parts.some((part) => part.toLowerCase() === plan.toLowerCase())) {
    parts.push(plan);
  }
  return parts.join(" | ") || "Coverage not recorded";
}
