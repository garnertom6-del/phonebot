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

export const PROVIDER_CHOICE_PLAN_OPTIONS = INSURANCE_PLAN_MAP.map((item) => item.providerChoice);

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
      return key === normalizedAlias || key.includes(normalizedAlias) || normalizedAlias.includes(key);
    }));
}

export function recordNumberPrefix(value: string): string {
  const plan = matchingPlan(value);
  return plan ? RECORD_NUMBER_PREFIXES[plan.key] || "OTHER" : "";
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
