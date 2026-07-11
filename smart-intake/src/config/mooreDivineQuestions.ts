/**
 * The client-facing questionnaire for the Moore Divine Care Client Intake
 * Package. Question keys line up with the `source` keys in
 * mooreDivinePacketMap.json - one answer can fill many places in the PDF.
 */

export type QType =
  | "text" | "textarea" | "date" | "phone" | "email" | "number"
  | "radio" | "chips" | "yesno" | "consent" | "info" | "survey" | "heading";

export interface AskIf { key: string; equals?: string; oneOf?: string[]; truthy?: boolean }

export interface Question {
  key: string;
  label: string;
  type: QType;
  options?: string[];
  required?: boolean;
  voice?: boolean;          // show microphone button
  placeholder?: string;
  help?: string;
  askIf?: AskIf;
  consentText?: string;     // for type=consent: the readable legal text
  staffOnly?: boolean;      // never shown to client; appears in staff review
  essential?: boolean;      // asked even in Quick Intake (CCA-expected) mode
}

export interface Section {
  key: string;
  title: string;
  intro?: string;
  fastIntake?: boolean;     // included in "Fast Intake: required questions first"
  questions: Question[];
}

const YN = ["Yes", "No"];

/** Standard PHQ-9 / GAD-7 frequency scale (score 0-3 by position). */
export const MOOD_FREQ = ["Not at all", "Several days", "More than half the days", "Nearly every day"] as const;

const PHQ9_ITEMS: [string, string][] = [
  ["phq9_q1", "Little interest or pleasure in doing things"],
  ["phq9_q2", "Feeling down, depressed, or hopeless"],
  ["phq9_q3", "Trouble falling or staying asleep, or sleeping too much"],
  ["phq9_q4", "Feeling tired or having little energy"],
  ["phq9_q5", "Poor appetite or overeating"],
  ["phq9_q6", "Feeling bad about yourself - or that you are a failure or have let yourself or your family down"],
  ["phq9_q7", "Trouble concentrating on things, such as reading or watching television"],
  ["phq9_q8", "Moving or speaking so slowly that other people could have noticed - or the opposite, being fidgety or restless"],
  ["phq9_q9", "Thoughts that you would be better off dead or of hurting yourself in some way"],
];

const GAD7_ITEMS: [string, string][] = [
  ["gad7_q1", "Feeling nervous, anxious, or on edge"],
  ["gad7_q2", "Not being able to stop or control worrying"],
  ["gad7_q3", "Worrying too much about different things"],
  ["gad7_q4", "Trouble relaxing"],
  ["gad7_q5", "Being so restless that it is hard to sit still"],
  ["gad7_q6", "Becoming easily annoyed or irritable"],
  ["gad7_q7", "Feeling afraid as if something awful might happen"],
];

export const SECTIONS: Section[] = [
  {
    key: "welcome", title: "Welcome", fastIntake: true,
    intro:
      "You are completing your intake for services with Moore Divine Care, Inc. " +
      "After this intake, a clinical assessor will follow up with you to complete an assessment. " +
      "That assessment helps determine what type of services and support you will receive. " +
      "Answer at your own pace - your progress is saved so you can come back later. " +
      "Every box with a microphone lets you SPEAK your answer instead of typing. " +
      "You will sign once at the end.",
    questions: [{
      key: "intake_mode", label: "How would you like to work through this?",
      type: "radio", required: true,
      options: ["Fast Intake - required questions first", "Full Intake - answer everything now"],
    }],
  },
  {
    key: "basic", title: "Basic Information", fastIntake: true,
    questions: [
      { key: "client_full_name", essential: true, label: "Client's full legal name", type: "text", required: true, voice: true },
      { key: "dob", essential: true, label: "Date of birth", type: "date", required: true },
      { key: "mid_number", essential: true, label: "Medicaid ID number (MID#)", type: "text", voice: true, help: "Skip if you don't have it handy - staff can add it later." },
      { key: "client_email", essential: true, label: "Email address", type: "email" },
    ],
  },
  {
    key: "demographics", title: "Demographics", fastIntake: true,
    questions: [
      { key: "gender", essential: true, label: "Gender", type: "radio", required: true, options: ["Female", "Male", "Transgender", "Other"] },
      { key: "race", essential: true, label: "Race", type: "radio", options: ["American Indian or Alaska Native", "Asian", "Black or African American", "Caucasian or White", "Multiracial", "Native American", "Native Hawaiian or Pacific Islander"] },
      { key: "ethnicity", essential: true, label: "Ethnicity", type: "radio", options: ["Hispanic/White", "Non-Hispanic/White", "Latino", "Hispanic/Black", "Non-Hispanic/Black"] },
      { key: "marital_status", essential: true, label: "Marital status", type: "radio", options: ["Single", "Married", "Separated", "Widowed"] },
      { key: "veteran", label: "Are you a veteran?", type: "yesno", options: YN },
      { key: "education", label: "Highest education", type: "radio", options: ["Grade/Elementary", "High School/GED", "College", "Graduate", "Post Graduate"] },
      { key: "language", label: "Preferred language", type: "radio", options: ["English", "Spanish", "French", "German", "Other"] },
      { key: "language_other", label: "Which language?", type: "text", voice: true, askIf: { key: "language", equals: "Other" } },
      { key: "communication_level", label: "Communication level", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
    ],
  },
  {
    key: "contact", title: "Address & Contact", fastIntake: true,
    questions: [
      { key: "address_street", essential: true, label: "Street address", type: "text", required: true, voice: true },
      { key: "address_city", essential: true, label: "City", type: "text", voice: true },
      { key: "address_state", essential: true, label: "State", type: "text", placeholder: "NC" },
      { key: "client_phone_cell", essential: true, label: "Cell phone", type: "phone", required: true },
      { key: "client_phone_home", label: "Home phone (same as cell unless different)", type: "phone" },
      { key: "client_phone_work", label: "Work phone", type: "phone" },
      { key: "living_arrangement", label: "Living arrangement", type: "radio", options: ["Adult with Spouse", "Adult with Relative", "Adult Alone", "Homeless", "Residential", "Living in hospital/institution", "Child with Parent", "Child with other relative", "Child with Non-relative"] },
      { key: "lives_with_whom", label: "Who do you live with?", type: "text", voice: true },
      { key: "lives_where", label: "Where (city/area)?", type: "text", voice: true },
      { key: "effects_on_home", label: "How do you get along with the people you live with?", type: "textarea", voice: true },
      { key: "employment_status", essential: true, label: "Employment status", type: "radio", options: ["Not in Labor Force", "Unemployed", "Disabled", "Employed"] },
      { key: "occupation", label: "Occupation", type: "text", voice: true, askIf: { key: "employment_status", equals: "Employed" } },
      { key: "employer_name", label: "Employer name", type: "text", voice: true, askIf: { key: "employment_status", equals: "Employed" } },
      { key: "employer_address", label: "Employer address", type: "text", voice: true, askIf: { key: "employment_status", equals: "Employed" } },
      { key: "employer_phone", label: "Employer phone", type: "phone", askIf: { key: "employment_status", equals: "Employed" } },
    ],
  },
  {
    key: "insurance", title: "Insurance & Funding", fastIntake: true,
    questions: [
      { key: "has_medicaid", essential: true, label: "Do you have Medicaid?", type: "yesno", options: YN, required: true },
      { key: "medicaid_effective_date", label: "Medicaid effective date (if known)", type: "date", askIf: { key: "has_medicaid", equals: "Yes" } },
      { key: "has_medicare", label: "Do you have Medicare?", type: "yesno", options: YN },
      { key: "medicare_effective_date", label: "Medicare effective date (if known)", type: "date", askIf: { key: "has_medicare", equals: "Yes" } },
      { key: "funding_other", label: "Other funding source", type: "text", voice: true },
      { key: "mco", label: "Your health plan (MCO/LME)", type: "radio", staffOnly: true, options: ["Alliance", "Partners BH", "Trillium", "Vaya", "AmeriHealth", "Carolina Complete", "Healthy Blue Medicaid", "United Healthcare", "Wellcare", "Not sure"] },
      { key: "has_nchc", label: "Do you have NC Health Choice (NCHC)?", type: "yesno", options: YN },
      { key: "nchc_policy", label: "NCHC policy number", type: "text", askIf: { key: "has_nchc", equals: "Yes" } },
      { key: "nchc_effective_date", label: "NCHC effective date", type: "date", askIf: { key: "has_nchc", equals: "Yes" } },
      { key: "dss_ive_eligible", label: "If in DSS custody: IV-E eligible?", type: "text", help: "Leave blank if not in DSS custody." },
      { key: "income_sources", label: "Income sources (pick all that apply)", type: "chips", options: ["Employment", "Disability", "VA Benefits", "Other"] },
      { key: "income_other", label: "Other income source", type: "text", voice: true, askIf: { key: "income_sources", oneOf: ["Other"] } },
    ],
  },
  {
    key: "referral", title: "Referral & Screening", fastIntake: true,
    questions: [
      { key: "referral_source", label: "Who referred you to us?", type: "radio", options: ["Self", "DSS", "LME", "Provider Agency", "State Facility", "Private Physician", "Social Agency", "Employer", "School", "Voc. Rehab", "Family/Friend", "Inpatient/Outpatient Facility"] },
      { key: "social_agency_name", label: "Which social agency?", type: "text", voice: true, askIf: { key: "referral_source", equals: "Social Agency" } },
      { key: "referred_for", label: "What services were you referred for? (pick all that apply)", type: "chips", options: ["Case Management", "Case Support", "Community Support Team", "Comprehensive Clinical Assessment", "Diagnostic Assessment", "Individual Support Services", "In-Home Therapy Services", "Intensive In-Home Services", "Medication Management", "Outpatient Therapy", "Peer Support Services", "Residential Level III", "Substance Abuse Intensive Outpatient"] },
    ],
  },
  {
    key: "services", title: "Services Requested", fastIntake: true,
    questions: [
      { key: "services_requested", label: "Which services are you interested in?", type: "chips", options: ["CST", "IIH", "OPT", "Med Mgt", "Residential", "Case Support", "Peer Support", "CCA", "Psychological Eval.", "Individual Support", "In-Home Therapy Service"] },
      { key: "services_other", label: "Other service", type: "text", voice: true },
    ],
  },
  {
    key: "presenting", title: "What Brings You In", fastIntake: true,
    intro: "Take your time here - tap the microphone and just talk. This is the most important answer in here.",
    questions: [
      { key: "presenting_problem", essential: true, label: "In your own words: what brings you in, and why do you feel the need for services?", type: "textarea", required: true, voice: true },
      { key: "other_agencies", label: "Other agencies or providers you receive (or received) services from", type: "textarea", voice: true },
    ],
  },
  {
    // PHQ-9 + GAD-7: public-domain standardized mood/anxiety screens with
    // automatic scoring (shown to staff on the intake page). Part of the FULL
    // intake only - Quick Intake stays short. Answers use the standard
    // 0-3 frequency scale stored as the option text.
    key: "mood_check", title: "How You Have Been Feeling",
    intro: "Over the LAST 2 WEEKS, how often have these things bothered you? There are no wrong answers.",
    questions: [
      ...PHQ9_ITEMS.map(([key, label]): Question => ({
        key, label: `Over the last 2 weeks: ${label}`, type: "radio", options: [...MOOD_FREQ],
        ...(key === "phq9_q9" ? { help: "If you feel like hurting yourself right now, please call 988 or 336-285-5204. Someone is there for you." } : {}),
      })),
      ...GAD7_ITEMS.map(([key, label]): Question => ({
        key, label: `Over the last 2 weeks: ${label}`, type: "radio", options: [...MOOD_FREQ],
      })),
    ],
  },
  {
    key: "snap", title: "Strengths, Needs, Abilities, Preferences",
    questions: [
      { key: "strengths", label: "What are your strengths?", type: "text", voice: true },
      { key: "needs", label: "What do you need most right now?", type: "text", voice: true },
      { key: "abilities", label: "What are you good at?", type: "text", voice: true },
      { key: "preferences", label: "Any preferences for your care (times, staff, location)?", type: "text", voice: true },
    ],
  },
  {
    key: "mental_health", title: "Mental Health",
    questions: [
      { key: "has_current_diagnosis", label: "Do you have a current mental health diagnosis?", type: "yesno", options: [...YN, "Not sure"] },
      { key: "diagnosis_list", label: "What diagnosis (as best you know)?", type: "textarea", voice: true, askIf: { key: "has_current_diagnosis", equals: "Yes" } },
      { key: "has_current_therapist", label: "Do you currently see a therapist?", type: "yesno", options: YN },
      { key: "therapist_name", label: "Therapist's name", type: "text", voice: true, askIf: { key: "has_current_therapist", equals: "Yes" } },
      { key: "therapist_agency_phone", label: "Therapist's agency / phone", type: "text", voice: true, askIf: { key: "has_current_therapist", equals: "Yes" } },
      { key: "receiving_mh_services", label: "Are you currently receiving any mental health services?", type: "yesno", options: YN },
      { key: "mh_services_desc", label: "Describe the services you receive", type: "textarea", voice: true, askIf: { key: "receiving_mh_services", equals: "Yes" } },
      { key: "mh_service_provider", label: "Service provider", type: "text", voice: true, askIf: { key: "receiving_mh_services", equals: "Yes" } },
      { key: "mh_history", label: "Any history of mental health issues we should know about?", type: "textarea", voice: true },
      { key: "current_diagnosis_known", label: "Current diagnosis, if known", type: "text", voice: true },
    ],
  },
  {
    key: "medical", title: "Medical Information",
    questions: [
      { key: "has_limitations", label: "Do you have any physical limitations?", type: "yesno", options: YN },
      { key: "limitations_desc", label: "Describe your limitations", type: "textarea", voice: true, askIf: { key: "has_limitations", equals: "Yes" } },
      { key: "pcp_name", label: "Primary care doctor's name", type: "text", voice: true },
      { key: "pcp_phone", label: "Doctor's phone", type: "phone" },
      { key: "pcp_address", label: "Doctor's address / practice", type: "text", voice: true },
      { key: "no_pcp_nearest_er", label: "I do NOT have a primary care doctor - use the nearest emergency facility", type: "yesno", options: YN },
      { key: "preferred_emergency_facility", label: "Preferred emergency room / hospital", type: "text", voice: true },
      { key: "medical_diagnoses", label: "Medical conditions / diagnoses (physical health)", type: "textarea", voice: true },
      { key: "treatments", label: "Treatments you receive for those conditions", type: "textarea", voice: true },
      { key: "hospitalizations", label: "Past hospitalizations or surgeries", type: "textarea", voice: true },
      { key: "last_physical_date", label: "Date of your last physical exam (approximate is fine)", type: "text", voice: true },
      { key: "height", label: "Height", type: "text", placeholder: "5'8\"" },
      { key: "weight", label: "Weight", type: "text", placeholder: "160 lbs" },
      { key: "hair_color", label: "Hair color", type: "text" },
      { key: "eye_color", label: "Eye color", type: "text" },
      { key: "identifying_marks", label: "Identifying marks, scars, tattoos", type: "text", voice: true },
      { key: "special_diets", label: "Special diets", type: "text", voice: true },
      { key: "medical_alerts", label: "Medical alerts and conditions staff should know in an emergency", type: "textarea", voice: true },
      { key: "fax", label: "Fax number (if you have one)", type: "text" },
    ],
  },
  {
    key: "medications", title: "Medications & Allergies",
    questions: [
      { key: "medications", label: "Prescription medications you take (name and dose)", type: "textarea", voice: true },
      { key: "otc_medications", label: "Over-the-counter medications", type: "textarea", voice: true },
      { key: "drug_allergies", label: "Drug allergies", type: "text", voice: true, placeholder: "None if none" },
      { key: "environmental_allergies", label: "Other allergies (food, environment)", type: "text", voice: true },
      { key: "allergies", label: "Any other allergies to list", type: "text", voice: true },
    ],
  },
  {
    key: "legal", title: "Legal & Guardian Information", fastIntake: true,
    questions: [
      { key: "pending_court_cases", label: "Any pending court cases?", type: "yesno", options: YN },
      { key: "court_case_desc", label: "Briefly describe", type: "textarea", voice: true, askIf: { key: "pending_court_cases", equals: "Yes" } },
      { key: "is_minor_or_incompetent", essential: true, label: "Is the client a minor, or an adult with a legal guardian?", type: "yesno", options: YN, required: true },
      { key: "date_adjudicated", label: "Date adjudicated (attach documents for staff)", type: "text", askIf: { key: "is_minor_or_incompetent", equals: "Yes" } },
      { key: "guardian_name", essential: true, label: "Legal guardian's full name", type: "text", voice: true, askIf: { key: "is_minor_or_incompetent", equals: "Yes" } },
      { key: "guardian_address", label: "Guardian's address", type: "text", voice: true, askIf: { key: "is_minor_or_incompetent", equals: "Yes" } },
      { key: "guardian_phone", essential: true, label: "Guardian's phone", type: "phone", askIf: { key: "is_minor_or_incompetent", equals: "Yes" } },
      { key: "guardian_email", label: "Guardian's email", type: "email", askIf: { key: "is_minor_or_incompetent", equals: "Yes" } },
    ],
  },
  {
    key: "emergency", title: "Emergency Contacts", fastIntake: true,
    questions: [
      { key: "ec1_name", essential: true, label: "Emergency contact 1 - name", type: "text", required: true, voice: true },
      { key: "ec1_street", label: "Contact 1 - street address", type: "text", voice: true },
      { key: "ec1_city", label: "Contact 1 - city", type: "text" },
      { key: "ec1_state", label: "Contact 1 - state", type: "text", placeholder: "NC" },
      { key: "ec1_home_phone", label: "Contact 1 - home phone", type: "phone" },
      { key: "ec1_work_phone", label: "Contact 1 - work phone", type: "phone" },
      { key: "ec1_cell_phone", essential: true, label: "Contact 1 - cell phone", type: "phone", required: true },
      { key: "ec2_name", label: "Emergency contact 2 - name (optional)", type: "text", voice: true },
      { key: "ec2_street", label: "Contact 2 - street address", type: "text", voice: true },
      { key: "ec2_city", label: "Contact 2 - city", type: "text" },
      { key: "ec2_state", label: "Contact 2 - state", type: "text" },
      { key: "ec2_home_phone", label: "Contact 2 - home phone", type: "phone" },
      { key: "ec2_work_phone", label: "Contact 2 - work phone", type: "phone" },
      { key: "ec2_cell_phone", label: "Contact 2 - cell phone", type: "phone" },
    ],
  },
  {
    key: "substance", title: "Substance Use",
    intro: "Honest answers help us take better care of you. This is confidential.",
    questions: [
      { key: "sa_status", label: "Have you ever had a substance abuse diagnosis, or do you use alcohol or other substances?", type: "radio", options: ["Yes", "No", "Denies"] },
      ...[1, 2, 3, 4, 5].flatMap((i): Question[] => [
        { key: `sub${i}_name`, label: `Substance ${i} - name`, type: "text", voice: true, askIf: { key: "sa_status", equals: "Yes" } },
        { key: `sub${i}_age_first`, label: `Substance ${i} - age of first use`, type: "text", askIf: { key: `sub${i}_name`, truthy: true } },
        { key: `sub${i}_freq`, label: `Substance ${i} - how often?`, type: "radio", options: ["Not used past month", "1-3x past month", "1-2x per week", "3-6x per week", "Daily"], askIf: { key: `sub${i}_name`, truthy: true } },
        { key: `sub${i}_route`, label: `Substance ${i} - how taken?`, type: "radio", options: ["Oral", "Smoking", "Inhalation", "Injection", "Other"], askIf: { key: `sub${i}_name`, truthy: true } },
        { key: `sub${i}_amount`, label: `Substance ${i} - average amount per day`, type: "text", askIf: { key: `sub${i}_name`, truthy: true } },
        { key: `sub${i}_last_used`, label: `Substance ${i} - date last used`, type: "text", askIf: { key: `sub${i}_name`, truthy: true } },
      ]),
    ],
  },
  {
    key: "provider_choice", title: "Provider Choice", fastIntake: true,
    questions: [
      { key: "provider_choice_plan", essential: true, staffOnly: true, label: "Which plan covers you? (marked on the Provider Choice form)", type: "radio", options: ["AmeriHealth", "Alliance", "Blue Cross Blue Shield", "Partners Behavioral Health", "Carolina Complete", "Sandhills Center/Trillium", "Healthy Blue", "Vaya", "Medicaid", "United Health Care", "Wellcare", "Not sure"] },
      {
        key: "consent_provider_choice", label: "Provider Choice", type: "consent", required: true,
        consentText: "I understand that I have the right to choose which provider will provide services to me. I have selected Moore Divine Care, Inc. as my provider of choice and have been offered a list of other providers who offer the same or similar services based on my medical needs. I understand that at any time I may change my service provider and will, if possible, provide reasonable notice so my records can transition. I may contact my Local Management Entity with questions or concerns.",
      },
    ],
  },
  {
    key: "orientation", title: "Client Orientation", fastIntake: true,
    questions: [{
      key: "consent_orientation", label: "Client Orientation Acknowledgment", type: "consent", required: true,
      consentText: "Upon admission I have been instructed in or given written materials regarding: my rights and responsibilities; grievance and appeal procedures; ways to give input on quality of care, outcomes and satisfaction; the organization's services, activities, expectations, hours of operation, after-hours access, code of ethics and confidentiality policy; follow-up requirements; financial obligations, fees and arrangements; the premises (emergency exits/shelters, fire suppression, first aid kits); policies on seclusion/restraint, smoking, illicit or licit drugs, weapons, and abuse & neglect; the person responsible for my service coordination; program rules including restrictions, events that may lead to loss of rights or privileges and how to regain them; advance directives where appropriate; the purpose and process of the assessment; how my individual plan is developed and my participation in it; transition criteria and procedures; and, when applicable, court appearance expectations and therapeutic interventions including sanctions, interventions, incentives, and administrative discharge criteria.",
    }],
  },
  {
    key: "rights", title: "Rights & Responsibilities", fastIntake: true,
    questions: [{
      key: "consent_rights", label: "Client Rights and Responsibilities Acknowledgment", type: "consent", required: true,
      consentText: "I have read and understand my rights as a program participant - including being treated with respect; being fully informed about my care; revoking consent at any time; receiving services in a safe, clean environment free of all forms of abuse; confidentiality protections under HIPAA and state law; filing grievances without retaliation; and receiving a written discharge plan. I also understand my responsibilities - to refrain from violence, abusive language, weapons, and drugs or alcohol; to be courteous; to share my strengths, needs, abilities and preferences honestly; to ask questions; to actively participate in treatment; and to attend services alcohol and drug free.",
    }],
  },
  {
    key: "treatment_consent", title: "Consent for Treatment", fastIntake: true,
    intro: "Your initials are applied to each numbered item below when you agree.",
    questions: [{
      key: "consent_treatment", label: "Consent for Treatment (items 1-6 initialed)", type: "consent", required: true,
      consentText: "1. I understand my protections regarding confidential information and its disclosure. 2. I understand I can contact the Governor's Advocacy Council for Persons with Disabilities (GACPD) / Disability Rights NC: 2626 Glenwood Avenue Suite 550, Raleigh NC 27608; Voice (919) 856-2195; Toll Free (877) 235-4210; TTY 888-268-5535; info@disabilityrightsnc.org. 3. I understand the benefits, potential risks, and possible alternative methods of treatment. 4. I understand I have the right to refuse treatment at any time but choose to consent to treatment at this time. 5. I have received a copy of 'Your Rights as a Client' and understand I have the right to be free from harm, abuse, neglect and exploitation. 6. I have received a copy of the consumer handbook and related application information. I also understand how to receive a copy of my service plan, the fees charged and collection of fees, the grievance procedure, suspension and expulsion from services, and search and seizure of personal possessions.",
    }],
  },
  {
    key: "crisis", title: "24-Hour Crisis / Bill of Rights", fastIntake: true,
    questions: [{
      key: "consent_bill_of_rights", label: "24-Hour On-Call & Bill of Rights", type: "consent", required: true,
      consentText: "I have been informed that Moore Divine Care, Inc. provides a 24 hours / 7 days a week emergency telephone number: the Crisis Number is 336-285-5204. I reviewed the Client Acknowledgment of 24 Hour On-Call Service, had the opportunity to ask questions, was provided the names of staff who will work with me and the days and times for each, and understand I should call to reschedule if there is a scheduling conflict. The Bill of Rights has been explained to me in terms that I understand, and I acknowledge that I have read and understand my rights and responsibilities.",
    }],
  },
  {
    key: "roi", title: "Release of Information",
    intro: "If you want us to coordinate with other doctors, agencies, schools or family, add them here. You can add up to three, and each one becomes a signed permission form.",
    questions: [1, 2, 3].flatMap((i): Question[] => [
      { key: `roi${i}_recipient`, label: `Release ${i} - who may we share records with?`, type: "text", voice: true, askIf: i === 1 ? undefined : { key: `roi${i - 1}_recipient`, truthy: true } },
      { key: `roi${i}_items`, label: `Release ${i} - what may we share?`, type: "chips", options: ["Admission/ Screening Assessment", "HIV related information", "Service Notes", "VO", "Medication history/ physician orders", "Psychological testing", "Service Plan", "LME", "Discharge Information", "Substance Abuse Information", "Psychiatric Evaluation", "Reciprocal exchange permitted", "Accounting of Disclosure Report", "NCTOPPS"], askIf: { key: `roi${i}_recipient`, truthy: true } },
      { key: `roi${i}_items_other`, label: `Release ${i} - other records to share`, type: "text", voice: true, askIf: { key: `roi${i}_recipient`, truthy: true } },
      { key: `roi${i}_purpose`, label: `Release ${i} - purpose`, type: "radio", options: ["Continuity of Care", "Referral", "Legal", "Service Delivery", "Service Authorization"], askIf: { key: `roi${i}_recipient`, truthy: true } },
      { key: `roi${i}_thru_date`, label: `Release ${i} - valid through (defaults to 1 year)`, type: "date", askIf: { key: `roi${i}_recipient`, truthy: true } },
      { key: `roi${i}_agreed`, label: `Release ${i} - HIV/AIDS & Substance Abuse Disclosure Consent`, type: "consent", askIf: { key: `roi${i}_recipient`, truthy: true }, consentText: "I give Moore Divine Care, Inc. consent to provide the checked protected medical information to the recipient named above, including information regarding treatment, hospitalization, and outpatient care, and not limited to HIV/AIDS, drug abuse, alcoholism or other substance abuse. I understand my alcohol and/or drug treatment records are protected under 42 C.F.R. Part 2 and HIPAA (45 C.F.R. Pts. 160 & 164) and cannot be disclosed without my written consent unless otherwise provided; HIV-related information is released only per G.S. 130A-143. This authorization is voluntary and valid for one (1) year from my signature or until I revoke it." },
    ]),
  },
  {
    key: "transport", title: "Transportation Consent",
    questions: [
      { key: "transport_destination", label: "Where would we transport you (destination/location)?", type: "text", voice: true },
      { key: "transport_purposes", label: "Purpose of transportation", type: "chips", options: ["Mental Health Services", "Developmental Services", "Substance Abuse Services", "Activities associated with treatment plan", "Other"] },
      { key: "consent_transport", label: "Consent to Transport", type: "consent", consentText: "I authorize Moore Divine Care, Inc. to provide transportation for the purpose of providing comprehensive Mental Health / Developmental / Substance Abuse services and other activities associated with my treatment plan. I understand that Moore Divine Care, Inc. is not responsible for any accidents that may occur while transportation is being provided. I certify these statements have been read and explained to me." },
    ],
  },
  {
    key: "emergency_care", title: "Emergency Care Consent", fastIntake: true,
    questions: [
      { key: "consent_emergency_info", label: "Emergency Information is correct", type: "consent", required: true, consentText: "The emergency information I provided is correct to the best of my knowledge. I hereby grant Moore Divine Care, Inc. permission to administer or seek emergency treatment for me." },
      { key: "consent_emergency_care", label: "Consent to Emergency Care", type: "consent", required: true, consentText: "As a client, parent, or legal guardian I authorize Moore Divine Care, Inc. to obtain emergency medical care for me or my child if the need arises. I have provided the medical facility of my preference; if this is not possible the nearest emergency facility will become my preference. Every attempt will be made to contact my emergency contacts, for whom I have given consent for release of confidential medical information." },
    ],
  },
  {
    key: "interventions", title: "Emergency Interventions",
    questions: [
      { key: "intervention_target_behaviors", label: "Target behaviors (if discussed with staff - can be left for staff)", type: "text", voice: true },
      { key: "intervention_valid_until", label: "Consent valid until (max 1 year - defaults to 1 year from today)", type: "date" },
      { key: "consent_emergency_interventions", label: "Consent for Emergency Interventions", type: "consent", consentText: "I have been informed that Moore Divine Care, Inc. will use verbal prompts and NCI emergency interventions, used only when non-physical interventions have proven ineffective or behavior poses a threat of imminent, serious physical harm to self and/or others. I understand the definitions of therapeutic holds, physical escort, emergency intervention, and emergency restraint (more than 20 minutes, requiring additional staff). I have been informed of the alleged benefits, potential risks, and possible alternative methods of treatment/habilitation, and I give my consent. This consent is valid for no more than one year and may be withdrawn at any time." },
    ],
  },
  {
    key: "treatment_plan", title: "Treatment Plan Participation",
    questions: [
      { key: "consent_treatment_plan_participation", label: "Treatment Plan Participation", type: "consent", consentText: "I have met (or will meet) in person with agency staff to review and discuss my concerns regarding the goals and outcomes represented in the treatment plan. The goals and clinical direction meet my expectations and I am in agreement with the direction of services." },
      { key: "consent_receipt_treatment_plan", staffOnly: true, label: "Receipt of Treatment Plan", type: "consent", consentText: "I have received and understand the current treatment plan for my child or myself, and I have been given a copy of the current treatment plan." },
    ],
  },
  {
    key: "hipaa", title: "HIPAA / Privacy Notice", fastIntake: true,
    intro: "Federal law protects your health information. The notice explains how medical information about you may be used and disclosed and how you can get access to it.",
    questions: [
      { key: "hipaa_understood", essential: true, label: "I understand the information that was explained to me and had the opportunity to ask questions", type: "yesno", options: YN, required: true },
      { key: "hipaa_copy", essential: true, staffOnly: true, label: "I was given a copy of this information", type: "yesno", options: YN, required: true },
      { key: "consent_hipaa", label: "Notice of Privacy Practices Acknowledgment", type: "consent", required: true, consentText: "I reviewed the notice describing how medical information about me may be used and disclosed and how I can get access to this information. I understand my rights: to see and get a copy of my health records, to have corrections added, to receive a notice about how my information is used and shared, to decide whether to give permission before my information is used for certain purposes such as marketing, and to get a report on when and why it was shared. My health information cannot be used or shared without my written permission unless the law allows it, and I may file a complaint with my provider or the U.S. Government (www.hhs.gov/ocr/hipaa) if I believe my rights are denied." },
    ],
  },
  {
    key: "confidentiality", title: "Confidentiality Exceptions", fastIntake: true,
    questions: [{
      key: "consent_confidentiality", label: "Confidentiality Exception Form", type: "consent", required: true,
      consentText: "I understand Moore Divine Care, Inc. has strict Confidentiality and Client Rights policies that prohibit release of confidential consumer information. The exceptions under N.C.G.S. §§ 122C-53 through 122C-56 have been explained to me and I agree with them - including disclosure of admission/discharge to next of kin when in my best interest; internal client advocate access; court orders and abuse reports; care and treatment coordination between facilities; emergencies where there is imminent danger; benefits and educational eligibility; referring physician requests; and research, planning and audits where allowed. If I feel my confidentiality rights have been violated I may contact the Client Rights Committee Chair Person at 336-285-5204.",
    }],
  },
  {
    key: "welcome_letter", title: "Welcome Letter", fastIntake: true,
    intro: "A welcome letter from the Executive and Leadership Team (Karen Jones, Nurse Practitioner; Tonya Jones, Clinical Director; Thadeous Young, Qualified Professional). Office hours: Greensboro Office, Monday through Friday, 10am-4pm. Emergency number: 336-285-5204. The mission: dedicated to the empowerment of You, our client, striving to assist you, your family and other stakeholders in achieving an enhanced quality of life through effective, efficient person-centered services.",
    questions: [{ key: "welcome_letter_ack", essential: true, staffOnly: true, label: "I have received the welcome letter", type: "yesno", options: ["Yes"], required: true }],
  },
  {
    key: "survey", title: "First-Contact Survey",
    intro: "1 = Does Not Meet Expectation, 2 = Meets Expectation, 3 = Exceeds Expectation",
    questions: [
      { key: "survey_q1", label: "I got into the program within timeframes that were explained to me", type: "survey" },
      { key: "survey_q2", label: "The staff was courteous, professional, and explained services in a way I understood", type: "survey" },
      { key: "survey_q4", label: "I was allowed and encouraged to provide input about my presenting problems and history", type: "survey" },
      { key: "survey_q5", label: "I was informed whether I qualified and whether the agency could provide recommended services", type: "survey" },
      { key: "survey_q6", label: "I participated in my treatment plan and understood goals, time limits, and the discharge plan", type: "survey" },
      { key: "survey_q7", label: "The facilities are clean and accessible", type: "survey" },
      { key: "survey_q8", label: "I was shown the evacuation policy, escape routes, and meeting point", type: "survey" },
      { key: "survey_q9", label: "I would recommend Moore Divine Care, Inc. to family and friends", type: "survey" },
    ],
  },
  {
    key: "referrals", title: "Referrals for Services",
    intro: "Moore Divine Care has adult and kids services. Add anyone who may benefit, plus their phone number if you have it.",
    questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((i): Question[] => [
      { key: `ref${i}_name`, label: `Referral ${i} - name`, type: "text", voice: true, askIf: i === 1 ? undefined : { key: `ref${i - 1}_name`, truthy: true } },
      { key: `ref${i}_phone`, label: `Referral ${i} - phone`, type: "phone", askIf: { key: `ref${i}_name`, truthy: true } },
    ]),
  },
  {
    key: "cca", title: "Clinical Assessment Signature", fastIntake: true,
    questions: [{
      key: "consent_cca", label: "Comprehensive Clinical Assessment Signature Page", type: "consent", required: true,
      consentText: "My signature affirms that I have met with this clinician either face to face, via telemedicine, or another approved form as mandated by law, and agree with the information gathered during this assessment. I understand the conclusions and recommendations are based on the information I gave the clinician and on collateral supports/contacts, represent my needs at the time of the assessment, and may change based on ongoing assessment of my needs.",
    }],
  },
  {
    key: "tailored_plan", title: "Tailored Plan Permission", fastIntake: true,
    questions: [{
      key: "consent_tailored_plan", label: "Tailored Plan Insurance Permission", type: "consent", required: true,
      consentText: "If the service ordered by the physician is not covered in my insurance plan, I give Moore Divine Care, Inc. permission to switch my insurance to the Tailored Plan that best suits my service needs.",
    }],
  },
];

/** Staff-only field groups shown in the staff review screen (never to clients). */
export const STAFF_FIELDS: { group: string; fields: Question[] }[] = [
  {
    group: "Header / Record",
    fields: [
      { key: "record_number", label: "Record #", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "intake_date", label: "Date of intake", type: "date" },
      { key: "referral_date", label: "Referral date", type: "date" },
    ],
  },
  {
    group: "Page 1 - Document Checklist",
    fields: [
      "chk_applicant_forms|Complete applicant forms", "chk_social_history|Social History",
      "chk_psych_eval|Psychological evaluation within past year", "chk_last_placement|Pertinent records of last placement",
      "chk_court_history|History of court involvement", "chk_birth_cert|Copy of Birth Certificate",
      "chk_insurance_card|Copy of Health Insurance Card", "chk_court_order|Copy of court order (DSS/guardian custody)",
      "chk_ss_card|Copy of Social Security Card", "chk_iep|Current or last IEP, T/HP, school records",
      "chk_medications|Medications & medication education info", "chk_pcp_plan|Copy of current Person-Centered Plan",
      "chk_immunizations|Copy of immunization records", "chk_standing_orders|Signed Physician Standing Orders",
    ].map((s) => {
      const [key, label] = s.split("|");
      return { key: `staff_${key}`, label, type: "yesno" as QType, options: ["Yes", "No"] };
    }),
  },
  {
    group: "Screening (page 3)",
    fields: [
      { key: "staff_receiving_intake", label: "Staff person receiving intake call", type: "text" },
      { key: "screening_date", label: "Screening date", type: "date" },
      { key: "qp_referred_to", label: "QP referred to", type: "text" },
      { key: "program_can_meet_needs", label: "Can program meet service/staffing/schedule needs?", type: "yesno", options: YN },
      { key: "program_cannot_meet_desc", label: "If no - what could not be met / referrals made", type: "textarea" },
      { key: "admission_date", label: "Admission date", type: "date" },
      { key: "initial_screening_date", label: "Initial screening date", type: "date" },
      { key: "initial_assessment_date", label: "Initial assessment date", type: "date" },
      { key: "official_admission_date", label: "Official admission date", type: "date" },
    ],
  },
  {
    group: "Clinical (pages 4-9)",
    fields: [
      { key: "placement_considerations", label: "Placement (match) considerations", type: "textarea" },
      { key: "social_family_medical_history", label: "Pertinent social/family/medical history", type: "textarea" },
      { key: "additional_evals", label: "Additional evaluations present", type: "chips", options: ["Psychological", "Substance Abuse", "Psychiatric", "Educational", "Vocational", "Other"] },
      { key: "severity_of_need", label: "Severity of need", type: "radio", options: ["Emergent", "Urgent", "Routine", "Non-Threshold"] },
      { key: "severity_explanation", label: "Severity explanation", type: "textarea" },
      { key: "ace_events", label: "Adverse Childhood Events", type: "textarea" },
      { key: "at_risk_types", label: "Type of client - at risk", type: "chips", options: ["Substance Abuse", "BEH", "Suicidal", "Psychotic", "Behavioral Issues", "Physical Aggression", "Verbal Aggression", "SIB", "Property Destruction", "Other Behaviors"] },
      { key: "sa_primary_diagnosis", label: "Primary diagnosis", type: "text" },
      { key: "sa_secondary_diagnosis", label: "Secondary diagnosis", type: "text" },
      { key: "ability_to_provide", label: "Able to provide recommended services?", type: "yesno", options: YN },
      { key: "clinician_name", label: "Licensed clinician (printed name)", type: "text" },
      { key: "medical_director_name", label: "Medical director (printed name)", type: "text" },
    ],
  },
  {
    group: "PCP Collaboration (pages 29-30)",
    fields: [
      { key: "c_practice", label: "PCP practice name", type: "text" },
      { key: "c_secure_fax", label: "PCP secure fax", type: "text" },
      { key: "c_secure_email", label: "PCP secure email", type: "email" },
      { key: "c_agency_secure_fax", label: "Agency secure fax", type: "text" },
      { key: "c_reason", label: "Reason for communication", type: "chips", options: ["Coordination of care", "Patient determined to be Mentally Ill", "Medication Change", "Significant change in diagnosis", "Transferring care back to PCP", "Annual Notification"] },
      { key: "c_requested", label: "Requested from PCP", type: "chips", options: ["Medical Diagnosis", "List of all medications", "Behavioral Health Assessment", "Individual Service Plan", "Clinical Impression"] },
      { key: "c_requested_other", label: "Other requested information", type: "text" },
      { key: "c_axis1", label: "Axis I (on file)", type: "text" }, { key: "c_axis2", label: "Axis II", type: "text" },
      { key: "c_axis3", label: "Axis III", type: "text" }, { key: "c_axis4", label: "Axis IV", type: "text" },
      { key: "c_axis5", label: "Axis V", type: "text" },
      { key: "c_psych_name", label: "Psychiatrist/NP/PA name", type: "text" },
      { key: "c_psych_email", label: "Psychiatrist email", type: "email" }, { key: "c_psych_phone", label: "Psychiatrist phone", type: "phone" },
      { key: "c_cm_name", label: "Case manager name", type: "text" },
      { key: "c_cm_email", label: "Case manager email", type: "email" }, { key: "c_cm_phone", label: "Case manager phone", type: "phone" },
      { key: "c_other_name", label: "Other contact name", type: "text" },
      { key: "c_other_email", label: "Other contact email", type: "email" }, { key: "c_other_phone", label: "Other contact phone", type: "phone" },
      { key: "c_clinician", label: "Clinician completing form", type: "text" },
      { key: "c_clinician_title", label: "Clinician title", type: "text" },
      { key: "c_date_sent", label: "Date sent", type: "date" },
      { key: "c_sent_method", label: "Sent by", type: "radio", options: ["Mailed", "Faxed", "Emailed"] },
    ],
  },
  {
    group: "Transition / Discharge Summary (pages 25-27, completed at discharge)",
    fields: [
      { key: "dis_admission_date", label: "Date of admission", type: "date" },
      { key: "dis_discharge_date", label: "Date of transition/discharge", type: "date" },
      { key: "dis_programs", label: "Program(s) client served in", type: "text" },
      ...[1, 2, 3, 4, 5].flatMap((i): Question[] => [
        { key: `dis_adm_axis${i}`, label: `Admission diagnosis - Axis ${["I", "II", "III", "IV", "V"][i - 1]}`, type: "text" },
        { key: `dis_dc_axis${i}`, label: `Discharge diagnosis - Axis ${["I", "II", "III", "IV", "V"][i - 1]}`, type: "text" },
      ]),
      { key: "dis_summary", label: "Summary / presenting needs", type: "textarea" },
      { key: "dis_pcp_plan", label: "PCP plan description & progress", type: "textarea" },
      { key: "dis_strengths", label: "Strengths (S)", type: "text" }, { key: "dis_needs", label: "Needs (N)", type: "text" },
      { key: "dis_abilities", label: "Abilities (A)", type: "text" }, { key: "dis_preferences", label: "Preferences (P)", type: "text" },
      { key: "dis_reason", label: "Reason for discharge/transition", type: "textarea" },
      { key: "dis_continuing_care", label: "Need for continuing care & level", type: "textarea" },
      { key: "dis_comments", label: "Additional comments", type: "textarea" },
      { key: "dis_residence_type", label: "Residence type", type: "radio", options: ["Private Home", "ALF/Residential/Group Home/Halfway House", "Inpatient Psych/State Hospital/Medical Hospital", "Foster Care Placement", "Other"] },
      { key: "dis_residence_detail", label: "Residence detail / persons in home & relationship", type: "text" },
      { key: "dis_followup_psych", label: "Follow-up - psychiatric", type: "text" },
      { key: "dis_followup_medical", label: "Follow-up - medical", type: "text" },
      { key: "dis_followup_therapy", label: "Follow-up - therapy", type: "text" },
      { key: "dis_followup_labs", label: "Follow-up - labs", type: "text" },
      { key: "dis_followup_support", label: "Follow-up - support group", type: "text" },
      { key: "dis_followup_dropin", label: "Follow-up - drop-in", type: "text" },
      { key: "dis_medications", label: "Medications (name/dosage/frequency)", type: "textarea" },
      { key: "dis_pharmacy", label: "Pharmacy", type: "text" },
      { key: "dis_employment_where", label: "Employment - where", type: "text" },
      { key: "dis_client_comments", label: "Client comments", type: "textarea" },
      { key: "dis_crisis_contact", label: "Crisis recurrence contact (name)", type: "text" },
      { key: "dis_crisis_phone", label: "Crisis recurrence contact (phone)", type: "phone" },
      { key: "dis_prepared_by", label: "Prepared by", type: "text" },
    ],
  },
  {
    group: "CCA additional participants (page 41)",
    fields: [1, 2, 3, 4].flatMap((i): Question[] => [
      { key: `cca_part${i}_name`, label: `Participant ${i} - name`, type: "text" },
      { key: `cca_part${i}_rel`, label: `Participant ${i} - relationship`, type: "text" },
      { key: `cca_part${i}_date`, label: `Participant ${i} - date`, type: "date" },
    ]),
  },
  {
    group: "Treatment plan signature rows (page 42)",
    fields: [1, 2, 3].flatMap((i): Question[] => [
      { key: `otp_row${i}_staff_date`, label: `Row ${i} - staff date`, type: "date" },
      { key: `otp_row${i}_client_date`, label: `Row ${i} - client date`, type: "date" },
    ]),
  },
  {
    // Captured from the clinician's CCA for the record and staff review.
    // These have no packet blank to print into - they preserve clinical
    // detail the paper form has no room for.
    group: "Clinical details from the CCA (kept on record, not printed)",
    fields: [
      { key: "cca_assessment_date", label: "CCA assessment date", type: "text" },
      { key: "cca_session_location", label: "CCA session location (office/virtual/home)", type: "text" },
      { key: "cca_provider_credentials", label: "Assessing clinician - name, credentials & license #s", type: "text" },
      { key: "diagnosis_third", label: "Additional diagnosis (3rd+) with code", type: "text" },
      { key: "cca_asam_level", label: "ASAM level of care recommendation", type: "text" },
      { key: "cca_asam_dimensions", label: "ASAM dimensions summary (1-6)", type: "textarea" },
      { key: "cca_mse_summary", label: "Mental status exam summary", type: "textarea" },
      { key: "cca_clinical_impressions", label: "Clinical impressions summary", type: "textarea" },
      { key: "cca_recommendations", label: "Clinician's recommendations", type: "textarea" },
      { key: "cca_employment_history", label: "Employment history", type: "text" },
      { key: "cca_transportation", label: "Transportation situation / barriers", type: "text" },
      { key: "cca_adl_needs", label: "Daily living / basic needs", type: "text" },
    ],
  },
];

/** Required answer keys checked before the client may submit. */
export const REQUIRED_FOR_SUBMIT: { key: string; label: string; when?: AskIf }[] = [
  { key: "client_full_name", label: "Client name" },
  { key: "dob", label: "Date of birth" },
  { key: "address_street", label: "Street address" },
  { key: "client_phone_cell", label: "Phone (or email)" },
  { key: "gender", label: "Gender" },
  { key: "ec1_name", label: "Emergency contact" },
  { key: "presenting_problem", label: "Presenting problem" },
  { key: "consent_provider_choice", label: "Provider choice acknowledgment" },
  { key: "consent_treatment", label: "Consent for treatment" },
  { key: "consent_emergency_care", label: "Emergency care consent" },
  { key: "consent_hipaa", label: "HIPAA/privacy acknowledgment" },
  { key: "consent_confidentiality", label: "Confidentiality exception acknowledgment" },
];

export const ALL_CONSENT_KEYS = SECTIONS.flatMap((s) =>
  s.questions.filter((q) => q.type === "consent").map((q) => q.key));

/** Keys a CLIENT may write through their intake link. Staff-only fields
 *  (clinical, screening, discharge, header/record) are not in SECTIONS and
 *  therefore can never be changed from a client token. */
export const CLIENT_ANSWER_KEYS: ReadonlySet<string> = new Set(
  SECTIONS.flatMap((s) =>
    s.questions.filter((q) => !q.staffOnly && q.type !== "info" && q.type !== "heading").map((q) => q.key)),
);

export const CLIENT_PREFILLED_QUESTION_KEYS: ReadonlySet<string> = new Set([
  "client_full_name",
  "dob",
  "mid_number",
  "client_email",
  "client_phone_cell",
  "is_minor_or_incompetent",
  "guardian_name",
  "guardian_phone",
  "guardian_email",
]);

function hasPrefilledClientValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== false;
}

export function isQuestionPrefilledForClient(q: Question, initialAnswers: Record<string, unknown>): boolean {
  if (q.key === "has_medicaid") {
    return hasPrefilledClientValue(initialAnswers.has_medicaid) || hasPrefilledClientValue(initialAnswers.mid_number);
  }
  return CLIENT_PREFILLED_QUESTION_KEYS.has(q.key) && hasPrefilledClientValue(initialAnswers[q.key]);
}

export function questionByKey(key: string): Question | undefined {
  for (const s of SECTIONS) for (const q of s.questions) if (q.key === key) return q;
  for (const g of STAFF_FIELDS) for (const q of g.fields) if (q.key === key) return q;
  return undefined;
}

/** True when a question is part of the shortened Quick Intake (CCA-expected) flow. */
export function isQuickIntakeQuestion(q: Question): boolean {
  return q.essential === true || q.required === true;
}
