import { DIRECTORY_RELEASE } from "./directoryCatalog";

/** Internal staff reference only; no client screening or referral state. */
export const BENEFITS_VERIFIED_ON = DIRECTORY_RELEASE.checkedOn;
export const BENEFIT_NEEDS = [
  { id: "coverage", label: "Health coverage" },
  { id: "care", label: "Mental health & daily support" },
  { id: "food", label: "Food" },
  { id: "housing", label: "Housing" },
  { id: "utilities", label: "Heating & utilities" },
  { id: "transport", label: "Getting to appointments" },
  { id: "income", label: "Income & work" },
  { id: "family", label: "Children & family" },
] as const;
export type BenefitNeed = (typeof BENEFIT_NEEDS)[number]["id"];
export interface BenefitResource {
  id: string;
  title: string;
  needs: readonly BenefitNeed[];
  why: string;
  nextStep: string;
  verify: string;
  url: string;
  source: string;
  availability?: string;
}
export const DSS_DIRECTORY = "https://www.ncdhhs.gov/divisions/social-services/local-dss-directory";
export const PLAN_DIRECTORY = "https://medicaid.ncdhhs.gov/beneficiaries/medicaid-health-plans-and-programs";
const BENEFIT_REFERENCE_ENTRIES: readonly BenefitResource[] = [
  {
    id: "medicaid", title: "NC Medicaid application or renewal", needs: ["coverage"],
    why: "Coverage ended, there is no insurance, or you are unsure about coverage.",
    nextStep: "Review the application or renewal steps with your county DSS. Ask what documents are needed.",
    verify: "An old Medicaid card or ID does not confirm current coverage. DSS determines eligibility.",
    url: "https://medicaid.ncdhhs.gov/apply", source: "NC Medicaid",
  },
  {
    id: "uninsured-care", title: "Care when insurance does not cover the need", needs: ["coverage", "care"],
    why: "Mental health, substance use, disability or brain injury support is needed and coverage is missing or insufficient.",
    nextStep: "Ask the county's LME/MCO about available services, funding and providers accepting referrals.",
    verify: "Available funding, services and admission requirements must be confirmed. A referral does not authorize treatment.",
    url: "https://www.ncdhhs.gov/assistance/mental-health-and-substance-use-disorders", source: "NCDHHS",
  },
  {
    id: "plan-support", title: "Health plan benefits & care coordination", needs: ["coverage", "care", "transport"],
    why: "You want to ask about extra services from your plan or help coordinating care.",
    nextStep: "Verify the current plan, then ask member services about added benefits, a care manager and any needed Tailored Plan review.",
    verify: "Benefits vary by plan. Do not request a plan change without the person's permission and a review of current services.",
    url: PLAN_DIRECTORY, source: "NC Medicaid",
  },
  {
    id: "1915i", title: "1915(i) home & community supports", needs: ["care", "income"],
    why: "Help is needed with daily living, community activities, work or caregiver respite.",
    nextStep: "Ask the plan or care manager whether a 1915(i) assessment is appropriate.",
    verify: "Available through Tailored Plans and potentially Medicaid Direct or EBCI Tribal Option, not Standard Plans. Assessment and program approval are required.",
    url: "https://medicaid.ncdhhs.gov/beneficiaries/1915i", source: "NC Medicaid",
  },
  {
    id: "fns", title: "Food and Nutrition Services (food assistance)", needs: ["food"],
    why: "There is difficulty paying for groceries.",
    nextStep: "Review FNS application options through ePASS or county DSS and ask about the required documents.",
    verify: "DSS reviews household circumstances and program rules; selecting this option is not an approval.",
    url: "https://www.ncdhhs.gov/divisions/child-and-family-well-being/food-and-nutrition-services-food-stamps/apply-food-and-nutrition-services-food-stamps", source: "NCDHHS",
  },
  {
    id: "wic", title: "WIC nutrition support", needs: ["food", "family"],
    why: "Food support is wanted during pregnancy, after pregnancy, while breastfeeding, or for a child under five.",
    nextStep: "Contact a local WIC agency using the state's application guide.",
    verify: "WIC has additional requirements. Medicaid, FNS or TANF can satisfy the income requirement only.",
    url: "https://www.ncdhhs.gov/divisions/child-and-family-well-being/community-nutrition-services-section/wic/apply-wic", source: "NCDHHS",
  },
  {
    id: "energy", title: "Heating bills & energy crisis assistance", needs: ["utilities", "housing"],
    why: "Heating bills are unaffordable, or a heating/cooling crisis affects health or safety.",
    nextStep: "Ask county DSS about LIEAP for heating costs or the Crisis Intervention Program for a current energy crisis.",
    verify: "Confirm the current application period, available funds and household requirements.",
    url: "https://www.ncdhhs.gov/divisions/social-services/energy-assistance", source: "NCDHHS",
  },
  {
    id: "nemt", title: "Medicaid rides to medical appointments", needs: ["transport"],
    why: "Transportation is a barrier to a Medicaid-covered appointment, including mental health visits.",
    nextStep: "Managed-care members should ask their plan about a ride. For Medicaid Direct or EBCI, use the state's DSS guidance.",
    verify: "Confirm coverage, destination, advance scheduling and the correct transportation contact before booking.",
    url: "https://medicaid.ncdhhs.gov/county-playbook-medicaid-managed-care/nemt", source: "NC Medicaid",
  },
  {
    id: "ssi", title: "Supplemental Security Income (SSI)", needs: ["income"],
    why: "Income and resources are limited and the person is 65 or older, blind, or may have a qualifying disability.",
    nextStep: "Use Social Security's eligibility and application guidance or ask SSA for help applying.",
    verify: "SSA determines eligibility. A diagnosis in an intake or CCA does not establish disability eligibility.",
    url: "https://www.ssa.gov/ssi/eligibility", source: "Social Security Administration",
  },
  {
    id: "family-emergency", title: "Work First emergency assistance", needs: ["family", "housing", "utilities"],
    why: "A household with children is facing an emergency such as eviction or utility shutoff.",
    nextStep: "Contact county DSS and ask about Work First Emergency Assistance and the county's requirements.",
    verify: "County rules, available funding and other program conditions apply.",
    url: "https://www.ncdhhs.gov/divisions/social-services/work-first-family-assistance/work-first-emergency-assistance", source: "NCDHHS",
  },
  {
    id: "childcare", title: "Child care financial assistance", needs: ["family", "income"],
    why: "Child care costs make work, education or meeting family needs difficult.",
    nextStep: "Review the state's child care subsidy guidance and contact the local administering agency.",
    verify: "Eligibility, waiting lists, funding and family contributions must be confirmed locally.",
    url: "https://ncchildcare.ncdhhs.gov/Services/Financial-Assistance", source: "NC Division of Child Development and Early Education",
  },
  {
    id: "nc211", title: "NC 211 local resource search", needs: ["food", "housing", "utilities", "transport", "income", "family", "care", "coverage"],
    why: "A local resource is needed, or another program cannot help.",
    nextStep: "Search NC 211 or call 211 to ask about resources in your county, including food, shelter and utility help.",
    verify: "NC 211 provides information and referrals. Confirm availability directly with the listed program.",
    url: "https://nc211.org/about/", source: "NC 211 / United Way of North Carolina",
  },
  {
    id: "hop", title: "Healthy Opportunities Pilots", needs: ["food", "housing", "transport"],
    why: "Health-related food, housing or transportation support may be relevant to a Medicaid member.",
    nextStep: "Ask the plan or care manager to verify restart timing, service area and current referral options. Use other resources while availability is unclear.",
    verify: "The state has announced restart funding, but details are pending. Do not treat the program as open enrollment.",
    availability: "Restart details pending — verify availability",
    url: "https://www.ncdhhs.gov/about/department-initiatives/healthy-opportunities/healthy-opportunities-pilots", source: "NCDHHS",
  },
];

export const BENEFIT_RESOURCES = BENEFIT_REFERENCE_ENTRIES.map((resource) => ({
  ...resource,
  version: DIRECTORY_RELEASE.version,
  directoryEffectiveOn: DIRECTORY_RELEASE.effectiveOn,
  sourceEffectiveOn: null as string | null,
  checkedOn: DIRECTORY_RELEASE.checkedOn,
  ownerRole: DIRECTORY_RELEASE.ownerRole,
  reviewEveryDays: resource.id === "hop" ? 7 : DIRECTORY_RELEASE.reviewEveryDays,
}));
