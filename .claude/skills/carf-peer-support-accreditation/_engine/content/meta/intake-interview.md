---
id: intake-interview
title: Provider Intake Interview — the questions to ask, section by section
---
# Provider Intake Interview

Run this with the provider before building anything. Ask **section by section**, in one
sitting where possible — structural answers change what gets built, so a missed one
costs a rebuild.

Each question names the `provider.json` field it fills. **Anything the provider does not
know, leave blank.** A blank prints as `[FILL IN: …]` and lands in the blanks report.
Never fill one in on their behalf, and never guess a name, a date, or a credential.

## 0. Before you start — say these two things out loud

1. "You will need to buy the current Behavioral Health Standards Manual from carf.org.
   Nothing I produce replaces it, and everything stays stamped DRAFT until someone here
   checks the section map against your copy."
2. "CARF accredits **programs**, not job titles. There is no peer support accreditation.
   You'll be applying for a program — most likely Community Integration — and peer
   support is the workforce that delivers it. Getting that wrong on the application
   costs months."

## 1. The agency
| # | Ask | Fills |
|---|---|---|
| 1.1 | Full legal name, exactly as registered? | `legal_name` |
| 1.2 | Do you trade under a different name? | `dba` |
| 1.3 | For-profit or nonprofit? | `tax_status` |
| 1.4 | Physical address, and mailing address if different? | `address`, `city`, `state`, `zip` |
| 1.5 | Main phone and website? | `phone`, `website` |
| 1.6 | Which counties do you actually serve? | `counties_served` |
| 1.7 | Who governs — a board, or an owner/sole member? | `governing_body` |

## 2. What they are applying for — the structural questions
| # | Ask | Fills |
|---|---|---|
| 2.1 | Which CARF program are you applying for? *(If they say "peer support," correct it here.)* | `programs` |
| 2.2 | Which manual year / edition do you have? Have you bought it? | `manual_year` |
| 2.3 | Has anyone here opened it and checked the section structure? | `manual_verified` |
| 2.4 | First accreditation, or a resurvey? | `accreditation_type` |
| 2.5 | When do you want the survey? | `target_survey_month` |
| 2.6 | When did — or will — the program start delivering services and creating records? | `cycle_start`, `six_months_of_data_start` |
| 2.7 | Adults, adolescents, older adults, or a mix? **(gated)** | `population` |
| 2.8 | Where is service delivered? Ask about each by name: the office, out in the community, people's homes, telehealth, a **drop-in centre**, a **psychosocial clubhouse**, an **activity centre**, a **day programme**, residential. **(gated)** | `settings` |

*Why ask about the last four by name:* CARF's own Community Integration program description lists
psychosocial clubhouse, drop-in centre, activity centre and day programme as settings for this
program. A provider will often not volunteer "we have a drop-in" when asked where they deliver
service, because to them it is just the office. Ask about each one. A staffed site the agency
opens to participants changes safety inspections, drills, rights posting, attendance records and
staffing ratios, and the bundled content does not cover it yet — the gate will tell you so.

## 3. The five structural yes/no questions — ask them plainly
These change the factual claims the manual makes about the agency. Get them right.

| # | Ask | Fills | If yes |
|---|---|---|---|
| 3.1 | Do you prescribe, dispense, administer, or store medication in any way? | `administers_medication` | **Gate fires.** Medication management content must be written first. |
| 3.2 | Do you use any restraint, seclusion, or isolation? | `uses_restrictive_interventions` | **Gate fires.** |
| 3.3 | Do you hold substance use records under 42 CFR Part 2? | `handles_sud_records` | Part 2 content is added throughout. |
| 3.4 | Do staff transport people you serve? | `provides_transportation` | Driver, vehicle and consent requirements activate. |
| 3.5 | Do you deliver any service by video or phone? | `uses_telehealth` | Telehealth consent and competency requirements activate. |

## 4. Operations — drives the compliance calendar
| # | Ask | Fills |
|---|---|---|
| 4.1 | What shifts deliver service? *(Drills are required on every one of them.)* | `shifts` |
| 4.2 | How many sites do you control? | `sites` |
| 4.3 | How many vehicles are used for work? | `vehicles` |
| 4.4 | List every employee, contractor, intern and volunteer with client contact, and their hire date. | `staff` |
| 4.5 | What's your fiscal year? | `fiscal_year_start` |

## 5. Credentials, payers, systems
| # | Ask | Fills |
|---|---|---|
| 5.1 | What's the exact name of the peer credential in your state? | `state_peer_credential` |
| 5.2 | What state licence do you hold, if any? | `state_licensure` |
| 5.3 | Which EHR do you document in? | `ehr` |
| 5.4 | Which payers? Any single one over half your revenue? | `payers` |

## 6. Named people — leave blank if unknown
| # | Ask | Fills |
|---|---|---|
| 6.1 | CEO / Executive Director, and their exact title? | `ceo`, `ceo_title` |
| 6.2 | Program Director? | `program_director` |
| 6.3 | Who supervises the peer workforce? Are they a certified peer themselves? | `clinical_supervisor` |
| 6.4 | Who owns quality improvement? | `qi_coordinator` |
| 6.5 | Safety Officer? | `safety_officer` |
| 6.6 | Privacy Officer? | `privacy_officer` |
| 6.7 | Compliance Officer? | `compliance_officer` |

*One person may hold several. Put the same name in each — the manual records the assignment.*

## 7. Timeframes — theirs, not CARF's
Say out loud: "These are your operational choices. Your state rule or a payer contract
may be stricter, and the strictest one wins."

| # | Ask | Fills | Default |
|---|---|---|---|
| 7.1 | Referral to first contact? | `timeframes.ACCESS_DAYS` | 3 business days |
| 7.2 | Admission to signed plan? | `timeframes.PLAN_DAYS` | 30 days |
| 7.3 | How often is the plan reviewed? | `timeframes.REVIEW_DAYS` | 90 days |
| 7.4 | How long do staff have to write a note? | `timeframes.NOTE_HOURS` | 24 hours |
| 7.5 | Last contact to discharge summary? | `timeframes.DISCHARGE_DAYS` | 10 days |
| 7.6 | How long after discharge do you follow up? | `timeframes.FOLLOWUP_DAYS` | 30 days |
| 7.7 | How long do you keep records? | `timeframes.RETENTION_YEARS` | 7 years |

## 8. What already exists — saves them rewriting
Ask which of these they already have, and get a copy. Anything they have goes straight
into the Evidence Register instead of being written from scratch.

- Policy manual, in any state
- Job descriptions
- Consent, rights and grievance forms
- Person-centered plan and progress note templates
- Any strategic, safety, risk or QI plan
- Incident, grievance and drill records
- Personnel files
- Satisfaction survey results
- Board minutes
- Their last survey report, if this is a resurvey

## 9. Close the interview with this
"Anything you tell me you don't have, I'll leave blank and list. Nothing in this packet
will claim you do something you don't — the whole thing is built to make a gap visible
rather than paper over it, because a gap you can explain survives a survey and an
invented record ends an agency."
