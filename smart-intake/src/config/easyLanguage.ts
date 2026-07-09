/**
 * Ultra-simple (5th-grade reading level) phrasings for the Moore Divine Care
 * client questionnaire. Every question key in mooreDivineQuestions.ts SECTIONS
 * has an entry here. Tone: warm, short, non-judgmental - never clinical.
 *
 * `options` only re-labels how a choice is DISPLAYED; the original option
 * string is still what gets saved.
 */

export interface EasyText {
  q: string;              // the simple question, e.g. "What is your name?"
  help?: string;          // optional one-line hint
  options?: Record<string, string>; // original option -> simpler display text
  consentSimple?: string; // plain-language summary for consent questions
}

/* ------------------------------------------------------------------ */
/* Shared option maps for repeated questions                           */
/* ------------------------------------------------------------------ */

const FREQ_OPTIONS: Record<string, string> = {
  "Not used past month": "Not in the last month",
  "1-3x past month": "A few times a month",
  "1-2x per week": "Once or twice a week",
  "3-6x per week": "3 to 6 days a week",
  "Daily": "Every day",
};

const ROUTE_OPTIONS: Record<string, string> = {
  "Oral": "By mouth",
  "Inhalation": "Breathing it in (sniffing)",
  "Injection": "With a needle",
};

const ROI_ITEMS_OPTIONS: Record<string, string> = {
  "Admission/ Screening Assessment": "Notes from when you started with us",
  "HIV related information": "HIV information",
  "Service Notes": "Notes from your visits",
  "VO": "Doctor's verbal orders",
  "Medication history/ physician orders": "Your medicine list",
  "Psychological testing": "Test results",
  "Service Plan": "Your care plan",
  "LME": "Health plan paperwork",
  "Discharge Information": "Papers from when you finished care",
  "Substance Abuse Information": "Drug and alcohol treatment info",
  "Psychiatric Evaluation": "Mental health check-up report",
  "Reciprocal exchange permitted": "They can share info back with us",
  "Accounting of Disclosure Report": "A list of who has seen your records",
  "NCTOPPS": "State progress survey (NCTOPPS)",
};

const ROI_PURPOSE_OPTIONS: Record<string, string> = {
  "Continuity of Care": "So your care team can work together",
  "Referral": "To connect you with another provider",
  "Legal": "For court or legal needs",
  "Service Delivery": "To give you your services",
  "Service Authorization": "To get your services approved",
};

/* ------------------------------------------------------------------ */
/* Generated entries for repeated question families                    */
/* ------------------------------------------------------------------ */

function substanceEntries(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 5; i++) {
    out[`sub${i}_name`] = i === 1
      ? { q: "What do you use? Name one thing.", help: "Like alcohol, weed, pills, or anything else. No judging here." }
      : { q: "Do you use anything else? Name another one.", help: "It's okay to skip this if there's nothing more." };
    out[`sub${i}_age_first`] = { q: "How old were you when you first tried it?", help: "Your best guess is fine." };
    out[`sub${i}_freq`] = { q: "How often do you use it?", options: { ...FREQ_OPTIONS } };
    out[`sub${i}_route`] = { q: "How do you take it?", options: { ...ROUTE_OPTIONS } };
    out[`sub${i}_amount`] = { q: "About how much do you use in a day?", help: "Your best guess is fine." };
    out[`sub${i}_last_used`] = { q: "When did you last use it?", help: "A date or a guess, like 'last week', is fine." };
  }
  return out;
}

function roiEntries(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 3; i++) {
    out[`roi${i}_recipient`] = i === 1
      ? { q: "Who can we talk to about your care?", help: "A doctor, school, family member, or agency. Leave blank if nobody." }
      : { q: "Anyone else we can talk to about your care?", help: "Leave blank if there's nobody else." };
    out[`roi${i}_items`] = { q: "What can we share with this person?", help: "Pick only what you're okay with sharing.", options: { ...ROI_ITEMS_OPTIONS } };
    out[`roi${i}_items_other`] = { q: "Anything else we can share with them?", help: "It's okay to skip this." };
    out[`roi${i}_purpose`] = { q: "Why should we share it?", options: { ...ROI_PURPOSE_OPTIONS } };
    out[`roi${i}_thru_date`] = { q: "Until what date is this okay?", help: "If you skip this, it lasts one year." };
    out[`roi${i}_agreed`] = {
      q: "Do you agree to let us share this?",
      consentSimple:
        "This lets us share only the records you picked with the person you named. " +
        "It lasts one year. You can take it back any time - just tell us.",
    };
  }
  return out;
}

function referralEntries(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 10; i++) {
    out[`ref${i}_name`] = i === 1
      ? { q: "Do you know someone who could use our help? What is their name?", help: "Family or friends. Leave blank if not." }
      : { q: "Anyone else? What is their name?", help: "It's okay to stop here." };
    out[`ref${i}_phone`] = { q: "What is their phone number?" };
  }
  return out;
}

function emergencyContactEntries(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 2; i++) {
    out[`ec${i}_name`] = i === 1
      ? { q: "Who should we call if you need help fast?", help: "Someone you trust, like family or a close friend." }
      : { q: "Is there a second person we can call?", help: "It's okay to skip this one." };
    out[`ec${i}_street`] = { q: "What is their street address?", help: "It's okay if you don't know it." };
    out[`ec${i}_city`] = { q: "What city do they live in?" };
    out[`ec${i}_state`] = { q: "What state do they live in?", help: "Like NC." };
    out[`ec${i}_home_phone`] = { q: "What is their home phone?", help: "Skip it if they don't have one." };
    out[`ec${i}_work_phone`] = { q: "What is their work phone?", help: "Skip it if you don't know." };
    out[`ec${i}_cell_phone`] = { q: "What is their cell phone number?" };
  }
  return out;
}

function surveyEntries(): Record<string, EasyText> {
  const qs = [
    "Did we get you started as quickly as we said we would?",
    "Was our staff kind and easy to understand?",
    "Did staff explain your rights and give you phone numbers to call with questions?",
    "Did we let you tell your side of the story?",
    "Did we tell you if we could help you, and what help you can get?",
    "Did you help make your care plan and understand it?",
    "Is our building clean and easy to get around?",
    "Did we show you the exits and where to meet if there is an emergency?",
    "Would you tell family and friends to come here?",
  ];
  const out: Record<string, EasyText> = {};
  qs.forEach((q, idx) => {
    out[`survey_q${idx + 1}`] = { q, help: "1 = no, 2 = yes, 3 = better than I hoped." };
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Main map                                                            */
/* ------------------------------------------------------------------ */

export const EASY: Record<string, EasyText> = {
  /* ---------- welcome ---------- */
  intake_mode: {
    q: "How would you like to do this?",
    help: "Pick 'Fast' to answer just the must-answer questions first.",
    options: {
      "Fast Intake - required questions first": "Fast - just the must-answer questions first",
      "Full Intake - answer everything now": "Full - answer everything now",
    },
  },

  /* ---------- basic ---------- */
  client_full_name: { q: "What is your name?", help: "Your full name, like on your ID." },
  dob: { q: "When were you born?", help: "Your birthday." },
  mid_number: { q: "What is your Medicaid ID number?", help: "It's on your Medicaid card. Skip it if you don't have it handy." },
  client_email: { q: "What is your email address?", help: "Skip it if you don't have one." },

  /* ---------- demographics ---------- */
  gender: { q: "What is your gender?" },
  race: {
    q: "What is your race?",
    help: "Pick the one that fits you best.",
    options: { "Caucasian or White": "White" },
  },
  ethnicity: { q: "What is your background?", help: "Pick the one that fits you best." },
  marital_status: { q: "Are you single, married, separated, or widowed?", help: "Pick the one that fits you." },
  veteran: { q: "Were you ever in the military?" },
  education: {
    q: "How far did you go in school?",
    options: {
      "Grade/Elementary": "Elementary school",
      "High School/GED": "High school or GED",
      "College": "Some college or a college degree",
      "Graduate": "A degree after college (like a master's)",
      "Post Graduate": "Schooling after a master's (like a doctorate)",
    },
  },
  language: { q: "What language do you like to speak?" },
  language_other: { q: "Which language is that?" },
  communication_level: { q: "How easy is it for you to talk with people and be understood?" },

  /* ---------- contact ---------- */
  address_street: { q: "What is your street address?", help: "Where you live now, like 123 Main St." },
  address_city: { q: "What city do you live in?" },
  address_state: { q: "What state do you live in?", help: "Like NC." },
  client_phone_cell: { q: "What is your cell phone number?" },
  client_phone_home: { q: "Do you have a home phone too?", help: "Skip it if it's the same or you don't have one." },
  client_phone_work: { q: "Do you have a work phone?", help: "Skip it if not." },
  living_arrangement: {
    q: "Where do you live right now?",
    help: "Pick the one that fits best. Every answer is okay.",
    options: {
      "Adult with Spouse": "With my husband or wife",
      "Adult with Relative": "With family",
      "Adult Alone": "By myself",
      "Homeless": "I don't have a home right now",
      "Residential": "In a group home",
      "Living in hospital/institution": "In a hospital or care center",
      "Child with Parent": "Child living with a parent",
      "Child with other relative": "Child living with other family",
      "Child with Non-relative": "Child living with someone who is not family",
    },
  },
  lives_with_whom: { q: "Who lives with you?", help: "Like 'my mom and two kids'. Say 'nobody' if you live alone." },
  lives_where: { q: "What town or area is that in?" },
  effects_on_home: { q: "How do you get along with the people you live with?", help: "Just talk like you would to a friend." },
  employment_status: {
    q: "Do you have a job right now?",
    options: {
      "Not in Labor Force": "Not working (not looking)",
      "Unemployed": "Not working (looking for work)",
      "Disabled": "Can't work because of a disability",
      "Employed": "Working",
    },
  },
  occupation: { q: "What kind of work do you do?" },
  employer_name: { q: "Where do you work?", help: "The name of the place." },
  employer_address: { q: "What is your work address?" },
  employer_phone: { q: "What is the phone number at your work?" },

  /* ---------- insurance ---------- */
  has_medicaid: { q: "Do you have Medicaid?", help: "Medicaid is the health card from the state." },
  medicaid_effective_date: { q: "When did your Medicaid start?", help: "Skip it if you don't know." },
  has_medicare: { q: "Do you have Medicare?", help: "Medicare is the health card most people get at 65 or with a disability." },
  medicare_effective_date: { q: "When did your Medicare start?", help: "Skip it if you don't know." },
  funding_other: { q: "Is there any other way your care gets paid for?", help: "Skip it if not." },
  mco: {
    q: "Which health plan is on your card?",
    help: "Look at your insurance card. Pick 'Not sure' if you don't know.",
    options: {
      "Partners BH": "Partners",
      "Healthy Blue Medicaid": "Healthy Blue",
    },
  },
  has_nchc: { q: "Do you have NC Health Choice?", help: "It's a health plan for kids in North Carolina. Pick 'No' if you're not sure." },
  nchc_policy: { q: "What is the number on that card?" },
  nchc_effective_date: { q: "When did that plan start?", help: "Skip it if you don't know." },
  dss_ive_eligible: { q: "If DSS (Social Services) is your guardian, your worker can answer this one.", help: "It's okay to skip this. Our staff can fill it in later." },
  income_sources: {
    q: "Where does your money come from?",
    help: "Pick all that fit.",
    options: {
      "Employment": "A job",
      "Disability": "Disability check",
      "VA Benefits": "Money from the VA (veterans)",
    },
  },
  income_other: { q: "Where else does money come from?" },

  /* ---------- referral ---------- */
  referral_source: {
    q: "Who told you about us?",
    options: {
      "Self": "I found you on my own",
      "DSS": "Social Services (DSS)",
      "LME": "My health plan",
      "Provider Agency": "Another care agency",
      "State Facility": "A state hospital",
      "Private Physician": "My doctor",
      "Social Agency": "A community agency",
      "Voc. Rehab": "A job training program",
      "Inpatient/Outpatient Facility": "A hospital or clinic",
    },
  },
  social_agency_name: { q: "What is the name of that agency?" },
  referred_for: {
    q: "What kind of help did they say you need?",
    help: "Pick all that fit. It's okay to guess.",
    options: {
      "Case Management": "Someone to help set up your care",
      "Case Support": "Extra support with day-to-day needs",
      "Community Support Team": "A team that helps you out in the community",
      "Comprehensive Clinical Assessment": "A full check-in about your needs",
      "Diagnostic Assessment": "A check-up to see what's going on",
      "Individual Support Services": "One-on-one help",
      "In-Home Therapy Services": "Therapy at home",
      "Intensive In-Home Services": "Extra help at home for kids and families",
      "Medication Management": "Medicine check-ups",
      "Outpatient Therapy": "Talk therapy (counseling)",
      "Peer Support Services": "Support from someone who has been there",
      "Residential Level III": "A place to live with help",
      "Substance Abuse Intensive Outpatient": "A group program for drug or alcohol help",
    },
  },

  /* ---------- services ---------- */
  services_requested: {
    q: "What kind of help sounds right for you?",
    help: "Pick all that sound good. We'll figure it out together.",
    options: {
      "CST": "A team that helps you out in the community",
      "IIH": "Extra help at home for kids and families",
      "OPT": "Talk therapy (counseling)",
      "Med Mgt": "Medicine check-ups",
      "Residential": "A place to live with help",
      "Case Support": "Extra support with day-to-day needs",
      "Peer Support": "Support from someone who has been there",
      "CCA": "A full check-in about your needs",
      "Psychological Eval.": "Testing with a psychologist",
      "Individual Support": "One-on-one help",
      "In-Home Therapy Service": "Therapy at home",
    },
  },
  services_other: { q: "Is there any other kind of help you want?", help: "It's okay to skip this." },

  /* ---------- presenting ---------- */
  presenting_problem: {
    q: "Tell us what's going on. Why do you want help?",
    help: "Just talk like you would to a friend. You can press the microphone and speak.",
  },
  other_agencies: {
    q: "Have you gotten help from other places before? Tell us where.",
    help: "Like a clinic, counselor, or program. Say 'none' if none.",
  },

  /* ---------- snap ---------- */
  strengths: { q: "What are you good at? What do people like about you?", help: "Everyone has strengths. Even small ones count." },
  needs: { q: "What do you need most right now?" },
  abilities: { q: "What can you do well?", help: "Like cooking, fixing things, or being a good listener." },
  preferences: { q: "What would make your care work best for you?", help: "Like morning visits, a certain place, or someone you're comfortable with." },

  /* ---------- mental_health ---------- */
  has_current_diagnosis: { q: "Has a doctor ever told you the name of what you're dealing with?", help: "Like depression or anxiety. 'Not sure' is a fine answer." },
  diagnosis_list: { q: "What did they call it?", help: "Your best memory is fine." },
  has_current_therapist: { q: "Do you talk to a counselor or therapist right now?" },
  therapist_name: { q: "What is your therapist's name?" },
  therapist_agency_phone: { q: "Where do they work, or what is their phone number?" },
  receiving_mh_services: { q: "Are you getting any other mental health help right now?" },
  mh_services_desc: { q: "What kind of help are you getting?" },
  mh_service_provider: { q: "Who gives you that help?", help: "The name of the person or place." },
  mh_history: { q: "Have you had hard times with your feelings or your mind before? Tell us about it.", help: "Anything you share helps us help you. It's okay to skip." },
  current_diagnosis_known: { q: "If you know the name of your condition, write it here.", help: "It's okay to leave this blank." },

  /* ---------- medical ---------- */
  has_limitations: { q: "Is there anything your body can't do, or has a hard time doing?", help: "Like walking far, lifting, seeing, or hearing." },
  limitations_desc: { q: "Tell us about it." },
  pcp_name: { q: "Who is your doctor?", help: "The doctor you see for check-ups. Skip it if you don't have one." },
  pcp_phone: { q: "What is your doctor's phone number?" },
  pcp_address: { q: "Where is your doctor's office?" },
  no_pcp_nearest_er: { q: "If you don't have a doctor, is it okay to take you to the nearest emergency room?" },
  preferred_emergency_facility: { q: "Which hospital do you like to go to?", help: "Skip it if you don't have one." },
  medical_diagnoses: { q: "Do you have any health problems? Tell us about them.", help: "Like diabetes, asthma, or high blood pressure. Say 'none' if none." },
  treatments: { q: "What do you do or take for those health problems?" },
  hospitalizations: { q: "Have you ever stayed in a hospital or had surgery? Tell us about it.", help: "Say 'none' if none." },
  last_physical_date: { q: "When was your last check-up with a doctor?", help: "A guess is fine, like 'last spring'." },
  height: { q: "How tall are you?", help: "Like 5 feet 8 inches." },
  weight: { q: "About how much do you weigh?", help: "A guess is fine." },
  hair_color: { q: "What color is your hair?" },
  eye_color: { q: "What color are your eyes?" },
  identifying_marks: { q: "Do you have any scars, birthmarks, or tattoos?", help: "This helps us find you if you're ever lost or hurt." },
  special_diets: { q: "Are there foods you can't eat, or a special way you eat?", help: "Say 'none' if none." },
  medical_alerts: { q: "In an emergency, what should helpers know about your health?", help: "Like 'I have seizures' or 'I'm allergic to penicillin'." },
  fax: { q: "Do you have a fax number?", help: "Most people don't - just skip it." },

  /* ---------- medications ---------- */
  medications: { q: "What pills or medicine do you take from a doctor?", help: "Name and how much, if you know. Say 'none' if none." },
  otc_medications: { q: "What medicine do you take from the store?", help: "Like Tylenol or vitamins. Say 'none' if none." },
  drug_allergies: { q: "Is there any medicine that makes you sick?", help: "Say 'none' if none." },
  environmental_allergies: { q: "Are you allergic to any food or other things?", help: "Like peanuts, bees, or dust. Say 'none' if none." },
  allergies: { q: "Any other allergies we should know about?", help: "Say 'none' if none." },

  /* ---------- legal ---------- */
  pending_court_cases: { q: "Do you have to go to court for anything soon?", help: "This won't get you in trouble. It just helps us help you." },
  court_case_desc: { q: "Tell us a little about it.", help: "Just the basics are fine." },
  is_minor_or_incompetent: { q: "Is this intake for a child, or someone who has a legal guardian?" },
  date_adjudicated: { q: "When did a judge decide about the guardian?", help: "Skip it if you don't know. Staff can help with the papers later." },
  guardian_name: { q: "What is the guardian's full name?" },
  guardian_address: { q: "What is the guardian's address?" },
  guardian_phone: { q: "What is the guardian's phone number?" },
  guardian_email: { q: "What is the guardian's email?" },

  /* ---------- substance ---------- */
  sa_status: {
    q: "Do you drink alcohol or use drugs?",
    help: "Be honest - we are here to help, not to judge. Nobody gets in trouble.",
    options: { "No": "No, not right now", "Denies": "No, and I never have" },
  },

  /* ---------- provider_choice ---------- */
  provider_choice_plan: {
    q: "Which health plan covers you?",
    help: "Look at your insurance card if you're not sure. It's okay to skip this - our staff can help.",
    options: {
      "Partners Behavioral Health": "Partners",
      "Sandhills Center/Trillium": "Trillium (Sandhills Center)",
      "United Health Care": "United Healthcare",
      "Blue Cross Blue Shield": "Blue Cross Blue Shield",
    },
  },
  consent_provider_choice: {
    q: "Do you pick Moore Divine Care as your helper?",
    consentSimple:
      "This paper says you picked Moore Divine Care to help you, and that you saw a list of other places too. " +
      "You can change your mind and pick a different provider any time.",
  },

  /* ---------- orientation ---------- */
  consent_orientation: {
    q: "Did we explain how our program works?",
    consentSimple:
      "This says we told you how things work here - the rules, the hours, the costs, your rights, " +
      "and how to speak up if something is wrong. If anything is unclear, just ask us any time.",
  },

  /* ---------- rights ---------- */
  consent_rights: {
    q: "Do you understand your rights and your part?",
    consentSimple:
      "You have the right to be treated with respect, to be safe, and to have your information kept private. " +
      "Your part is to be kind, be honest, ask questions, and come to visits sober. You can speak up any time without getting in trouble.",
  },

  /* ---------- treatment_consent ---------- */
  consent_treatment: {
    q: "Do you say yes to getting help from us?",
    consentSimple:
      "This says yes, you want our help. We told you the good things, the risks, and other choices you have. " +
      "You can say no or stop at any time - it's always your choice.",
  },

  /* ---------- crisis ---------- */
  consent_bill_of_rights: {
    q: "Do you know you can call us any time, day or night?",
    consentSimple:
      "If you ever need help fast, call us any time at 336-285-5204 - day or night. " +
      "This also says we explained your rights in plain words and you got to ask questions.",
  },

  /* ---------- transport ---------- */
  transport_destination: { q: "Where would you need a ride to?", help: "Like our office or your appointments. Skip it if you don't need rides." },
  transport_purposes: {
    q: "What would the rides be for?",
    options: {
      "Mental Health Services": "Mental health visits",
      "Developmental Services": "Disability services",
      "Substance Abuse Services": "Drug or alcohol help",
      "Activities associated with treatment plan": "Things in your care plan",
    },
  },
  consent_transport: {
    q: "Is it okay for us to give you rides?",
    consentSimple:
      "This lets our staff drive you to your visits and activities. " +
      "You can stop the rides any time - just tell us.",
  },

  /* ---------- emergency_care ---------- */
  consent_emergency_info: {
    q: "Is your emergency info true, and can we get you help if needed?",
    consentSimple:
      "This says the emergency info you gave us is true, and that if you get hurt or sick, " +
      "we can get you medical help right away. It's there to keep you safe.",
  },
  consent_emergency_care: {
    q: "In an emergency, can we get a doctor for you?",
    consentSimple:
      "If there is an emergency, this lets us get medical care for you (or your child) fast. " +
      "We will use the hospital you picked if we can, and we will try to call your emergency contacts too.",
  },

  /* ---------- interventions ---------- */
  intervention_target_behaviors: { q: "Are there behaviors you and staff talked about watching for?", help: "It's okay to leave this for staff to fill in." },
  intervention_valid_until: { q: "Until what date is this okay?", help: "If you skip this, it lasts one year." },
  consent_emergency_interventions: {
    q: "If someone is about to get hurt, can staff step in to keep everyone safe?",
    consentSimple:
      "Staff always try talking first. Only if someone is about to get badly hurt, " +
      "this lets trained staff safely hold a person to stop it. You can take this back any time.",
  },

  /* ---------- treatment_plan ---------- */
  consent_treatment_plan_participation: {
    q: "Did you help make your care plan, and does it feel right?",
    consentSimple:
      "This says you talked with staff about your care plan and you like where it's going. " +
      "If you ever want changes, just tell us - it's your plan.",
  },
  consent_receipt_treatment_plan: {
    q: "Did you get a copy of your care plan?",
    consentSimple:
      "This says you got your own copy of your care plan and you understand it. " +
      "Ask us any time if something is not clear.",
  },

  /* ---------- hipaa ---------- */
  hipaa_understood: { q: "Did we explain how we protect your health information, and did you get to ask questions?" },
  hipaa_copy: { q: "Did you get a copy of that paper?" },
  consent_hipaa: {
    q: "Do you understand how we keep your health information private?",
    consentSimple:
      "This says we keep your health information private. We only share it when the law says we can. " +
      "You can see your records any time.",
  },

  /* ---------- confidentiality ---------- */
  consent_confidentiality: {
    q: "Do you understand the few times the law lets us share your information?",
    consentSimple:
      "We keep your information private. The law only lets us share it in special cases - " +
      "like a court order, or to keep someone safe in an emergency. " +
      "If you ever think we shared it wrongly, call 336-285-5204 and we will listen.",
  },

  /* ---------- welcome_letter ---------- */
  welcome_letter_ack: { q: "Did you get our welcome letter?", help: "It has our hours and our help line: 336-285-5204." },

  /* ---------- cca ---------- */
  consent_cca: {
    q: "Did you meet with our clinician, and does what we wrote match what you said?",
    consentSimple:
      "This says you met with our clinician and the notes match what you told them. " +
      "Your needs can change over time, and your plan can change with them.",
  },

  /* ---------- tailored_plan ---------- */
  consent_tailored_plan: {
    q: "If your insurance won't pay for care you need, can we switch you to a plan that will?",
    consentSimple:
      "Sometimes an insurance plan won't pay for a service your doctor says you need. " +
      "This lets us move you to a plan that covers it, so nothing gets in the way of your care.",
  },

  /* ---------- generated repeats ---------- */
  ...emergencyContactEntries(), // ec1_*, ec2_*
  ...substanceEntries(),        // sub1_* .. sub5_*
  ...roiEntries(),              // roi1_* .. roi3_*
  ...surveyEntries(),           // survey_q1 .. survey_q9
  ...referralEntries(),         // ref1_* .. ref10_*
};

/* ------------------------------------------------------------------ */
/* Section intros - one friendly sentence per section                  */
/* ------------------------------------------------------------------ */

export const SECTION_INTROS: Record<string, string> = {
  welcome: "Hi! Let's get you set up. Go at your own pace - your answers are saved.",
  basic: "First, a little about you.",
  demographics: "A few more quick questions about you.",
  contact: "How can we reach you?",
  insurance: "Let's talk about how your care gets paid for.",
  referral: "Who sent you our way?",
  services: "What kind of help sounds right for you?",
  presenting: "This is the big one - just tell us your story.",
  snap: "Tell us what makes you, you.",
  mental_health: "How have you been feeling?",
  medical: "Now a bit about your health and your doctor.",
  medications: "What medicine do you take?",
  legal: "A few quick legal questions. Honest answers help - nobody gets in trouble.",
  emergency: "Who should we call if you ever need help fast?",
  substance: "Some honest questions now. No judging here - ever.",
  provider_choice: "You get to pick who helps you.",
  orientation: "Here's how our program works.",
  rights: "You have rights. Here they are.",
  treatment_consent: "Saying yes to getting help.",
  crisis: "Help is always just a phone call away.",
  roi: "Who can we talk to about your care? Only who YOU say.",
  transport: "Need a ride to your visits? We can help.",
  emergency_care: "What we do if you ever get sick or hurt.",
  interventions: "How we keep everyone safe.",
  treatment_plan: "Your care plan is yours - you help build it.",
  hipaa: "Your health information stays private.",
  confidentiality: "The few times the law says we may share information.",
  welcome_letter: "A hello from our team.",
  survey: "How did we do so far? Be honest - it helps us do better.",
  referrals: "Know someone else who could use our help?",
  cca: "One last signature about your check-in.",
  tailored_plan: "Making sure insurance never blocks your care.",
};

/* ------------------------------------------------------------------ */
/* Encouragements shown between sections                               */
/* ------------------------------------------------------------------ */

export const ENCOURAGEMENTS: string[] = [
  "You're doing great!",
  "Nice work - keep going!",
  "Almost there - keep it up!",
  "You've got this!",
  "Great job so far!",
  "One step at a time - you're doing it!",
  "We're glad you're here.",
  "Asking for help takes courage. You're doing it!",
  "Keep going - you're closer than you think!",
  "Well done! Just a little more.",
];
