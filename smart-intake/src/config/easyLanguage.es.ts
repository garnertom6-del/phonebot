/**
 * Spanish (español) phrasings for the client questionnaire - same warm,
 * 5th-grade-level tone as easyLanguage.ts, using respectful "usted" forms.
 *
 * IMPORTANT: only the QUESTIONS, hints and plain-language summaries are
 * translated. The full legal consent texts (consentText) remain in English
 * until the agency obtains certified translations - the plain-language
 * summary tells the client to ask staff for a Spanish copy.
 *
 * PHQ-9 / GAD-7 stems follow the standard published Spanish versions
 * (both instruments are public domain).
 */
import type { EasyText } from "./easyLanguage";

/* ------------------------------------------------------------------ */
/* Common option strings -> Spanish display (used across questions)    */
/* ------------------------------------------------------------------ */

export const GLOBAL_OPTIONS_ES: Record<string, string> = {
  "Yes": "Sí",
  "No": "No",
  "Not sure": "No estoy seguro/a",
  // gender
  "Female": "Mujer",
  "Male": "Hombre",
  "Transgender": "Persona transgénero",
  "Other": "Otro",
  // race
  "American Indian or Alaska Native": "Indígena americano o nativo de Alaska",
  "Asian": "Asiático/a",
  "Black or African American": "Negro/a o afroamericano/a",
  "Caucasian or White": "Blanco/a",
  "Multiracial": "Multirracial",
  "Native American": "Nativo americano",
  "Native Hawaiian or Pacific Islander": "Nativo de Hawái o de las islas del Pacífico",
  // ethnicity
  "Hispanic/White": "Hispano/a - blanco/a",
  "Non-Hispanic/White": "No hispano/a - blanco/a",
  "Latino": "Latino/a",
  "Hispanic/Black": "Hispano/a - negro/a",
  "Non-Hispanic/Black": "No hispano/a - negro/a",
  // marital status
  "Single": "Soltero/a",
  "Married": "Casado/a",
  "Separated": "Separado/a",
  "Widowed": "Viudo/a",
  // education
  "Grade/Elementary": "Primaria",
  "High School/GED": "Secundaria o GED",
  "College": "Algo de universidad o un título",
  "Graduate": "Un título después de la universidad (como una maestría)",
  "Post Graduate": "Estudios después de la maestría (como un doctorado)",
  // language
  "English": "Inglés",
  "Spanish": "Español",
  "French": "Francés",
  "German": "Alemán",
  // communication level
  "Excellent": "Excelente",
  "Good": "Buena",
  "Fair": "Regular",
  "Poor": "Difícil",
  // mood scale (standard Spanish PHQ/GAD response set)
  "Not at all": "Para nada",
  "Several days": "Varios días",
  "More than half the days": "Más de la mitad de los días",
  "Nearly every day": "Casi todos los días",
  // survey scale
  "1": "1 - No",
  "2": "2 - Sí",
  "3": "3 - Mejor de lo que esperaba",
};

/* ------------------------------------------------------------------ */
/* Shared option maps                                                  */
/* ------------------------------------------------------------------ */

const FREQ_ES: Record<string, string> = {
  "Not used past month": "No en el último mes",
  "1-3x past month": "Unas pocas veces al mes",
  "1-2x per week": "Una o dos veces por semana",
  "3-6x per week": "De 3 a 6 días por semana",
  "Daily": "Todos los días",
};

const ROUTE_ES: Record<string, string> = {
  "Oral": "Por la boca",
  "Smoking": "Fumando",
  "Inhalation": "Aspirando (por la nariz)",
  "Injection": "Con aguja",
  "Other": "De otra forma",
};

const ROI_ITEMS_ES: Record<string, string> = {
  "Admission/ Screening Assessment": "Notas de cuando empezó con nosotros",
  "HIV related information": "Información sobre VIH",
  "Service Notes": "Notas de sus visitas",
  "VO": "Órdenes verbales del doctor",
  "Medication history/ physician orders": "Su lista de medicinas",
  "Psychological testing": "Resultados de pruebas",
  "Service Plan": "Su plan de cuidado",
  "LME": "Papeles del plan de salud",
  "Discharge Information": "Papeles de cuando terminó su cuidado",
  "Substance Abuse Information": "Información de tratamiento de drogas y alcohol",
  "Psychiatric Evaluation": "Informe de evaluación de salud mental",
  "Reciprocal exchange permitted": "Ellos también pueden compartir información con nosotros",
  "Accounting of Disclosure Report": "Una lista de quién ha visto sus registros",
  "NCTOPPS": "Encuesta estatal de progreso (NCTOPPS)",
};

const ROI_PURPOSE_ES: Record<string, string> = {
  "Continuity of Care": "Para que su equipo de cuidado trabaje unido",
  "Referral": "Para conectarle con otro proveedor",
  "Legal": "Para asuntos de corte o legales",
  "Service Delivery": "Para darle sus servicios",
  "Service Authorization": "Para que aprueben sus servicios",
};

/* ------------------------------------------------------------------ */
/* Generated entries for repeated question families                    */
/* ------------------------------------------------------------------ */

function substanceEntriesEs(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 5; i++) {
    out[`sub${i}_name`] = i === 1
      ? { q: "¿Qué usa? Nombre una cosa.", help: "Como alcohol, marihuana, pastillas, o cualquier otra cosa. Aquí nadie juzga." }
      : { q: "¿Usa algo más? Nombre otra cosa.", help: "Puede saltarse esta si no hay nada más." };
    out[`sub${i}_age_first`] = { q: "¿Qué edad tenía la primera vez que lo probó?", help: "Un cálculo aproximado está bien." };
    out[`sub${i}_freq`] = { q: "¿Con qué frecuencia lo usa?", options: { ...FREQ_ES } };
    out[`sub${i}_route`] = { q: "¿Cómo lo toma?", options: { ...ROUTE_ES } };
    out[`sub${i}_amount`] = { q: "¿Más o menos cuánto usa en un día?", help: "Un cálculo aproximado está bien." };
    out[`sub${i}_last_used`] = { q: "¿Cuándo fue la última vez que lo usó?", help: "Una fecha o un cálculo, como 'la semana pasada', está bien." };
  }
  return out;
}

function roiEntriesEs(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 3; i++) {
    out[`roi${i}_recipient`] = i === 1
      ? { q: "¿Con quién podemos hablar sobre su cuidado?", help: "Un doctor, escuela, familiar o agencia. Déjelo en blanco si nadie." }
      : { q: "¿Alguien más con quien podamos hablar sobre su cuidado?", help: "Déjelo en blanco si no hay nadie más." };
    out[`roi${i}_items`] = { q: "¿Qué podemos compartir con esta persona?", help: "Marque solo lo que le parezca bien compartir.", options: { ...ROI_ITEMS_ES } };
    out[`roi${i}_items_other`] = { q: "¿Algo más que podamos compartir con ellos?", help: "Puede saltarse esta." };
    out[`roi${i}_purpose`] = { q: "¿Por qué debemos compartirlo?", options: { ...ROI_PURPOSE_ES } };
    out[`roi${i}_thru_date`] = { q: "¿Hasta qué fecha está bien?", help: "Si la salta, dura un año." };
    out[`roi${i}_agreed`] = {
      q: "¿Está de acuerdo en dejarnos compartir esto?",
      consentSimple:
        "Esto nos deja compartir solo los registros que usted marcó, con la persona que usted nombró. " +
        "Dura un año. Puede cancelarlo cuando quiera - solo díganos.",
    };
  }
  return out;
}

function referralEntriesEs(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 10; i++) {
    out[`ref${i}_name`] = i === 1
      ? { q: "¿Conoce a alguien que necesite nuestra ayuda? ¿Cómo se llama?", help: "Familia o amigos. Déjelo en blanco si no." }
      : { q: "¿Alguien más? ¿Cómo se llama?", help: "Está bien parar aquí." };
    out[`ref${i}_phone`] = { q: "¿Cuál es su número de teléfono?" };
  }
  return out;
}

function emergencyContactEntriesEs(): Record<string, EasyText> {
  const out: Record<string, EasyText> = {};
  for (let i = 1; i <= 2; i++) {
    out[`ec${i}_name`] = i === 1
      ? { q: "¿A quién debemos llamar si usted necesita ayuda rápido?", help: "Alguien de confianza, como familia o un amigo cercano." }
      : { q: "¿Hay una segunda persona a quien podamos llamar?", help: "Puede saltarse esta." };
    out[`ec${i}_street`] = { q: "¿Cuál es su dirección?", help: "Está bien si no la sabe." };
    out[`ec${i}_city`] = { q: "¿En qué ciudad vive esa persona?" };
    out[`ec${i}_state`] = { q: "¿En qué estado vive?", help: "Como NC." };
    out[`ec${i}_home_phone`] = { q: "¿Cuál es su teléfono de casa?", help: "Sáltelo si no tiene." };
    out[`ec${i}_work_phone`] = { q: "¿Cuál es su teléfono del trabajo?", help: "Sáltelo si no lo sabe." };
    out[`ec${i}_cell_phone`] = { q: "¿Cuál es su número de celular?" };
  }
  return out;
}

function surveyEntriesEs(): Record<string, EasyText> {
  const qs = [
    "¿Le atendimos tan rápido como dijimos?",
    "¿Nuestro personal fue amable y fácil de entender?",
    "¿Le explicamos sus derechos y le dimos teléfonos para llamar con preguntas?",
    "¿Le dejamos contar su versión de las cosas?",
    "¿Le dijimos si podíamos ayudarle y qué ayuda puede recibir?",
    "¿Ayudó usted a hacer su plan de cuidado y lo entiende?",
    "¿Nuestro edificio está limpio y es fácil moverse en él?",
    "¿Le mostramos las salidas y dónde reunirse si hay una emergencia?",
    "¿Le diría a su familia y amigos que vengan aquí?",
  ];
  const out: Record<string, EasyText> = {};
  qs.forEach((q, idx) => {
    out[`survey_q${idx + 1}`] = { q, help: "1 = no, 2 = sí, 3 = mejor de lo que esperaba." };
  });
  return out;
}

function moodEntriesEs(): Record<string, EasyText> {
  // Standard Spanish PHQ-9 / GAD-7 stems (public domain instruments)
  const phq = [
    "¿Poco interés o placer en hacer las cosas?",
    "¿Se ha sentido decaído/a, deprimido/a o sin esperanzas?",
    "¿Problemas para dormir, o ha dormido demasiado?",
    "¿Se ha sentido cansado/a o con poca energía?",
    "¿Poco apetito, o ha comido en exceso?",
    "¿Se ha sentido mal con usted mismo/a - o que es un fracaso, o que le ha fallado a su familia?",
    "¿Problemas para concentrarse, como al leer o ver televisión?",
    "¿Se mueve o habla tan lento que otras personas lo han notado - o lo contrario, muy inquieto/a?",
    "¿Pensamientos de que estaría mejor muerto/a o de hacerse daño?",
  ];
  const gad = [
    "¿Se ha sentido nervioso/a, ansioso/a o con los nervios de punta?",
    "¿No ha podido parar o controlar la preocupación?",
    "¿Se ha preocupado demasiado por cosas diferentes?",
    "¿Problemas para relajarse?",
    "¿Tan inquieto/a que le cuesta quedarse quieto/a?",
    "¿Se ha molestado o irritado con facilidad?",
    "¿Ha sentido miedo, como si algo terrible fuera a pasar?",
  ];
  const out: Record<string, EasyText> = {};
  phq.forEach((q, i) => {
    out[`phq9_q${i + 1}`] = {
      q: `En las últimas 2 semanas: ${q}`,
      ...(i === 8 ? { help: "Si siente ganas de hacerse daño ahora mismo, llame al 988 o al 336-285-5204. Hay alguien para usted." } : {}),
    };
  });
  gad.forEach((q, i) => { out[`gad7_q${i + 1}`] = { q: `En las últimas 2 semanas: ${q}` }; });
  return out;
}

/* ------------------------------------------------------------------ */
/* Main map                                                            */
/* ------------------------------------------------------------------ */

export const EASY_ES: Record<string, EasyText> = {
  intake_mode: {
    q: "¿Cómo prefiere hacer esto?",
    help: "Elija 'Rápido' para contestar primero solo lo necesario.",
    options: {
      "Fast Intake - required questions first": "Rápido - solo las preguntas necesarias primero",
      "Full Intake - answer everything now": "Completo - contestar todo ahora",
    },
  },

  client_full_name: { q: "¿Cómo se llama?", help: "Su nombre completo, como aparece en su identificación." },
  dob: { q: "¿Cuándo nació?", help: "Su fecha de nacimiento." },
  mid_number: { q: "¿Cuál es su número de Medicaid?", help: "Está en su tarjeta de Medicaid. Sáltelo si no la tiene a mano." },
  client_email: { q: "¿Cuál es su correo electrónico?", help: "Sáltelo si no tiene." },

  gender: { q: "¿Cuál es su género?" },
  race: { q: "¿Cuál es su raza?", help: "Elija la que mejor le describa.", options: { "Caucasian or White": "Blanco/a" } },
  ethnicity: { q: "¿Cuál es su origen?", help: "Elija el que mejor le describa." },
  marital_status: { q: "¿Es usted soltero/a, casado/a, separado/a o viudo/a?", help: "Elija lo que le describa." },
  veteran: { q: "¿Estuvo alguna vez en el ejército?" },
  education: { q: "¿Hasta dónde llegó en la escuela?" },
  language: { q: "¿Qué idioma prefiere hablar?" },
  language_other: { q: "¿Qué idioma es?" },
  communication_level: { q: "¿Qué tan fácil es para usted hablar con la gente y que le entiendan?" },

  address_street: { q: "¿Cuál es su dirección?", help: "Donde vive ahora, como 123 Calle Principal." },
  address_city: { q: "¿En qué ciudad vive?" },
  address_state: { q: "¿En qué estado vive?", help: "Como NC." },
  client_phone_cell: { q: "¿Cuál es su número de celular?" },
  client_phone_home: { q: "¿Tiene también teléfono de casa?", help: "Sáltelo si es el mismo o no tiene." },
  client_phone_work: { q: "¿Tiene teléfono del trabajo?", help: "Sáltelo si no." },
  living_arrangement: {
    q: "¿Dónde vive ahora mismo?",
    help: "Elija lo que mejor encaje. Todas las respuestas están bien.",
    options: {
      "Adult with Spouse": "Con mi esposo/a",
      "Adult with Relative": "Con familia",
      "Adult Alone": "Solo/a",
      "Homeless": "No tengo casa ahora mismo",
      "Residential": "En un hogar de grupo",
      "Living in hospital/institution": "En un hospital o centro de cuidado",
      "Child with Parent": "Menor viviendo con un padre",
      "Child with other relative": "Menor viviendo con otra familia",
      "Child with Non-relative": "Menor viviendo con alguien que no es familia",
    },
  },
  lives_with_whom: { q: "¿Quién vive con usted?", help: "Como 'mi mamá y dos hijos'. Diga 'nadie' si vive solo/a." },
  lives_where: { q: "¿En qué pueblo o zona queda?" },
  effects_on_home: { q: "¿Cómo se lleva con las personas con las que vive?", help: "Hable como le hablaría a un amigo." },
  employment_status: {
    q: "¿Tiene trabajo ahora mismo?",
    options: {
      "Not in Labor Force": "No trabajo (y no estoy buscando)",
      "Unemployed": "No trabajo (estoy buscando)",
      "Disabled": "No puedo trabajar por una discapacidad",
      "Employed": "Trabajando",
    },
  },
  occupation: { q: "¿En qué trabaja?" },
  employer_name: { q: "¿Dónde trabaja?", help: "El nombre del lugar." },
  employer_address: { q: "¿Cuál es la dirección de su trabajo?" },
  employer_phone: { q: "¿Cuál es el teléfono de su trabajo?" },

  has_medicaid: { q: "¿Tiene Medicaid?", help: "Medicaid es la tarjeta de salud del estado." },
  medicaid_effective_date: { q: "¿Cuándo empezó su Medicaid?", help: "Sáltelo si no lo sabe." },
  has_medicare: { q: "¿Tiene Medicare?", help: "Medicare es la tarjeta de salud que la mayoría recibe a los 65 años o con una discapacidad." },
  medicare_effective_date: { q: "¿Cuándo empezó su Medicare?", help: "Sáltelo si no lo sabe." },
  funding_other: { q: "¿Hay otra forma en que se paga su cuidado?", help: "Sáltelo si no." },
  mco: {
    q: "¿Qué plan de salud aparece en su tarjeta?",
    help: "Mire su tarjeta de seguro. Elija 'No estoy seguro/a' si no sabe.",
    options: { "Partners BH": "Partners", "Healthy Blue Medicaid": "Healthy Blue" },
  },
  has_nchc: { q: "¿Tiene NC Health Choice?", help: "Es un plan de salud para niños en Carolina del Norte. Elija 'No' si no está seguro/a." },
  nchc_policy: { q: "¿Cuál es el número de esa tarjeta?" },
  nchc_effective_date: { q: "¿Cuándo empezó ese plan?", help: "Sáltelo si no lo sabe." },
  dss_ive_eligible: { q: "Si DSS (Servicios Sociales) es su tutor, su trabajador social puede contestar esta.", help: "Está bien saltarla. Nuestro personal puede llenarla después." },
  income_sources: {
    q: "¿De dónde viene su dinero?",
    help: "Marque todo lo que aplique.",
    options: { "Employment": "Un trabajo", "Disability": "Cheque de discapacidad", "VA Benefits": "Dinero del VA (veteranos)", "Other": "Otro" },
  },
  income_other: { q: "¿De dónde más viene dinero?" },

  referral_source: {
    q: "¿Quién le habló de nosotros?",
    options: {
      "Self": "Los encontré por mi cuenta",
      "DSS": "Servicios Sociales (DSS)",
      "LME": "Mi plan de salud",
      "Provider Agency": "Otra agencia de cuidado",
      "State Facility": "Un hospital del estado",
      "Private Physician": "Mi doctor",
      "Social Agency": "Una agencia comunitaria",
      "Employer": "Mi trabajo",
      "School": "La escuela",
      "Voc. Rehab": "Un programa de entrenamiento laboral",
      "Family/Friend": "Familia o amigos",
      "Inpatient/Outpatient Facility": "Un hospital o clínica",
    },
  },
  social_agency_name: { q: "¿Cómo se llama esa agencia?" },
  referred_for: {
    q: "¿Qué tipo de ayuda dijeron que necesita?",
    help: "Marque todo lo que aplique. Está bien adivinar.",
    options: {
      "Case Management": "Alguien que le ayude a organizar su cuidado",
      "Case Support": "Apoyo extra con las necesidades del día a día",
      "Community Support Team": "Un equipo que le ayuda en la comunidad",
      "Comprehensive Clinical Assessment": "Una revisión completa de sus necesidades",
      "Diagnostic Assessment": "Un chequeo para ver qué está pasando",
      "Individual Support Services": "Ayuda uno a uno",
      "In-Home Therapy Services": "Terapia en casa",
      "Intensive In-Home Services": "Ayuda extra en casa para niños y familias",
      "Medication Management": "Chequeos de medicinas",
      "Outpatient Therapy": "Terapia de conversación (consejería)",
      "Peer Support Services": "Apoyo de alguien que ha pasado por lo mismo",
      "Residential Level III": "Un lugar para vivir con ayuda",
      "Substance Abuse Intensive Outpatient": "Un programa de grupo para ayuda con drogas o alcohol",
    },
  },

  services_requested: {
    q: "¿Qué tipo de ayuda le suena bien?",
    help: "Marque todo lo que le suene bien. Lo resolvemos juntos.",
    options: {
      "CST": "Un equipo que le ayuda en la comunidad",
      "IIH": "Ayuda extra en casa para niños y familias",
      "OPT": "Terapia de conversación (consejería)",
      "Med Mgt": "Chequeos de medicinas",
      "Residential": "Un lugar para vivir con ayuda",
      "Case Support": "Apoyo extra con el día a día",
      "Peer Support": "Apoyo de alguien que ha pasado por lo mismo",
      "CCA": "Una revisión completa de sus necesidades",
      "Psychological Eval.": "Pruebas con un psicólogo",
      "Individual Support": "Ayuda uno a uno",
      "In-Home Therapy Service": "Terapia en casa",
    },
  },
  services_other: { q: "¿Hay algún otro tipo de ayuda que quiera?", help: "Puede saltarse esta." },

  presenting_problem: {
    q: "Cuéntenos qué está pasando. ¿Por qué quiere ayuda?",
    help: "Hable como le hablaría a un amigo. Puede tocar el micrófono y hablar.",
  },
  other_agencies: {
    q: "¿Ha recibido ayuda en otros lugares antes? Díganos dónde.",
    help: "Como una clínica, consejero o programa. Diga 'ninguno' si ninguno.",
  },

  strengths: { q: "¿En qué es bueno/a? ¿Qué le gusta de usted a la gente?", help: "Todos tenemos fortalezas. Las pequeñas también cuentan." },
  needs: { q: "¿Qué es lo que más necesita ahora mismo?" },
  abilities: { q: "¿Qué sabe hacer bien?", help: "Como cocinar, arreglar cosas, o saber escuchar." },
  preferences: { q: "¿Qué haría que su cuidado funcione mejor para usted?", help: "Como visitas por la mañana, cierto lugar, o alguien con quien se sienta cómodo/a." },

  has_current_diagnosis: { q: "¿Alguna vez un doctor le dijo el nombre de lo que usted tiene?", help: "Como depresión o ansiedad. 'No estoy seguro/a' es una buena respuesta." },
  diagnosis_list: { q: "¿Cómo lo llamaron?", help: "Lo que recuerde está bien." },
  has_current_therapist: { q: "¿Habla con un consejero o terapeuta ahora mismo?" },
  therapist_name: { q: "¿Cómo se llama su terapeuta?" },
  therapist_agency_phone: { q: "¿Dónde trabaja, o cuál es su teléfono?" },
  receiving_mh_services: { q: "¿Está recibiendo alguna otra ayuda de salud mental ahora?" },
  mh_services_desc: { q: "¿Qué tipo de ayuda está recibiendo?" },
  mh_service_provider: { q: "¿Quién le da esa ayuda?", help: "El nombre de la persona o el lugar." },
  mh_history: { q: "¿Ha pasado por momentos difíciles con sus emociones o su mente antes? Cuéntenos.", help: "Todo lo que comparta nos ayuda a ayudarle. Está bien saltarla." },
  current_diagnosis_known: { q: "Si sabe el nombre de su condición, escríbalo aquí.", help: "Está bien dejarlo en blanco." },

  has_limitations: { q: "¿Hay algo que su cuerpo no pueda hacer, o le cueste hacer?", help: "Como caminar lejos, cargar cosas, ver u oír." },
  limitations_desc: { q: "Cuéntenos sobre eso." },
  pcp_name: { q: "¿Quién es su doctor?", help: "El doctor que le hace los chequeos. Sáltelo si no tiene." },
  pcp_phone: { q: "¿Cuál es el teléfono de su doctor?" },
  pcp_address: { q: "¿Dónde queda el consultorio de su doctor?" },
  no_pcp_nearest_er: { q: "Si no tiene doctor, ¿está bien llevarle a la sala de emergencias más cercana?" },
  preferred_emergency_facility: { q: "¿A qué hospital le gusta ir?", help: "Sáltelo si no tiene uno." },
  medical_diagnoses: { q: "¿Tiene problemas de salud? Cuéntenos.", help: "Como diabetes, asma o presión alta. Diga 'ninguno' si ninguno." },
  treatments: { q: "¿Qué hace o toma para esos problemas de salud?" },
  hospitalizations: { q: "¿Ha estado internado/a en un hospital o ha tenido cirugías? Cuéntenos.", help: "Diga 'ninguna' si ninguna." },
  last_physical_date: { q: "¿Cuándo fue su último chequeo con un doctor?", help: "Un cálculo está bien, como 'la primavera pasada'." },
  height: { q: "¿Cuánto mide?", help: "Como 5 pies 8 pulgadas." },
  weight: { q: "¿Más o menos cuánto pesa?", help: "Un cálculo está bien." },
  hair_color: { q: "¿De qué color es su cabello?" },
  eye_color: { q: "¿De qué color son sus ojos?" },
  identifying_marks: { q: "¿Tiene cicatrices, marcas de nacimiento o tatuajes?", help: "Esto nos ayuda a encontrarle si alguna vez se pierde o se lastima." },
  special_diets: { q: "¿Hay comidas que no puede comer, o una forma especial de comer?", help: "Diga 'ninguna' si ninguna." },
  medical_alerts: { q: "En una emergencia, ¿qué deben saber los rescatistas sobre su salud?", help: "Como 'tengo convulsiones' o 'soy alérgico/a a la penicilina'." },
  fax: { q: "¿Tiene número de fax?", help: "La mayoría no tiene - sáltelo." },

  medications: { q: "¿Qué pastillas o medicinas toma recetadas por un doctor?", help: "Nombre y cantidad, si lo sabe. Diga 'ninguna' si ninguna." },
  otc_medications: { q: "¿Qué medicinas toma de la tienda?", help: "Como Tylenol o vitaminas. Diga 'ninguna' si ninguna." },
  drug_allergies: { q: "¿Hay alguna medicina que le haga daño?", help: "Diga 'ninguna' si ninguna." },
  environmental_allergies: { q: "¿Es alérgico/a a alguna comida u otra cosa?", help: "Como maní, abejas o polvo. Diga 'ninguna' si ninguna." },
  allergies: { q: "¿Alguna otra alergia que debamos saber?", help: "Diga 'ninguna' si ninguna." },

  pending_court_cases: { q: "¿Tiene que ir a la corte por algo pronto?", help: "Esto no le mete en problemas. Solo nos ayuda a ayudarle." },
  court_case_desc: { q: "Cuéntenos un poco sobre eso.", help: "Lo básico está bien." },
  is_minor_or_incompetent: { q: "¿Esta admisión es para un menor, o para alguien que tiene un tutor legal?" },
  date_adjudicated: { q: "¿Cuándo decidió un juez sobre el tutor?", help: "Sáltelo si no lo sabe. El personal puede ayudar con los papeles después." },
  guardian_name: { q: "¿Cuál es el nombre completo del tutor?" },
  guardian_address: { q: "¿Cuál es la dirección del tutor?" },
  guardian_phone: { q: "¿Cuál es el teléfono del tutor?" },
  guardian_email: { q: "¿Cuál es el correo del tutor?" },

  sa_status: {
    q: "¿Toma alcohol o usa drogas?",
    help: "Sea honesto/a - estamos aquí para ayudar, no para juzgar. Nadie se mete en problemas.",
    options: { "Yes": "Sí", "No": "No, ahora no", "Denies": "No, y nunca lo he hecho" },
  },

  provider_choice_plan: {
    q: "¿Qué plan de salud le cubre?",
    help: "Mire su tarjeta de seguro si no está seguro/a. Está bien saltarla - nuestro personal puede ayudar.",
    options: {
      "Partners Behavioral Health": "Partners",
      "Sandhills Center/Trillium": "Trillium (Sandhills Center)",
      "United Health Care": "United Healthcare",
      "Blue Cross Blue Shield": "Blue Cross Blue Shield",
      "Medicaid": "Medicaid",
    },
  },
  consent_provider_choice: {
    q: "¿Elige a Moore Divine Care para ayudarle?",
    consentSimple:
      "Este papel dice que usted eligió a Moore Divine Care para ayudarle, y que también vio una lista de otros lugares. " +
      "Puede cambiar de opinión y elegir otro proveedor cuando quiera. Pida al personal una copia en español del formulario completo.",
  },

  consent_orientation: {
    q: "¿Le explicamos cómo funciona nuestro programa?",
    consentSimple:
      "Esto dice que le explicamos cómo funcionan las cosas aquí - las reglas, los horarios, los costos, sus derechos, " +
      "y cómo quejarse si algo está mal. Si algo no está claro, pregúntenos cuando quiera. Pida una copia en español si la desea.",
  },

  consent_rights: {
    q: "¿Entiende sus derechos y su parte?",
    consentSimple:
      "Usted tiene derecho a que le traten con respeto, a estar seguro/a, y a que su información sea privada. " +
      "Su parte es ser amable, ser honesto/a, hacer preguntas, y venir a las visitas sobrio/a. Puede quejarse cuando quiera sin meterse en problemas.",
  },

  consent_treatment: {
    q: "¿Dice que sí a recibir ayuda de nosotros?",
    consentSimple:
      "Esto dice que sí, usted quiere nuestra ayuda. Le contamos lo bueno, los riesgos, y las otras opciones que tiene. " +
      "Puede decir que no o parar en cualquier momento - siempre es su decisión.",
  },

  consent_bill_of_rights: {
    q: "¿Sabe que puede llamarnos a cualquier hora, de día o de noche?",
    consentSimple:
      "Si alguna vez necesita ayuda rápido, llámenos a cualquier hora al 336-285-5204 - de día o de noche. " +
      "Esto también dice que le explicamos sus derechos con palabras sencillas y que pudo hacer preguntas.",
  },

  transport_destination: { q: "¿A dónde necesitaría transporte?", help: "Como nuestra oficina o sus citas. Sáltelo si no necesita transporte." },
  transport_purposes: {
    q: "¿Para qué serían los viajes?",
    options: {
      "Mental Health Services": "Visitas de salud mental",
      "Developmental Services": "Servicios de discapacidad",
      "Substance Abuse Services": "Ayuda con drogas o alcohol",
      "Activities associated with treatment plan": "Cosas de su plan de cuidado",
      "Other": "Otro",
    },
  },
  consent_transport: {
    q: "¿Está bien que le demos transporte?",
    consentSimple:
      "Esto deja que nuestro personal le lleve a sus visitas y actividades. " +
      "Puede parar los viajes cuando quiera - solo díganos.",
  },

  consent_emergency_info: {
    q: "¿Su información de emergencia es verdadera, y podemos conseguirle ayuda si hace falta?",
    consentSimple:
      "Esto dice que la información de emergencia que nos dio es verdadera, y que si se lastima o se enferma, " +
      "podemos conseguirle ayuda médica de inmediato. Es para mantenerle seguro/a.",
  },
  consent_emergency_care: {
    q: "En una emergencia, ¿podemos conseguirle un doctor?",
    consentSimple:
      "Si hay una emergencia, esto nos deja conseguir atención médica para usted (o su hijo/a) rápido. " +
      "Usaremos el hospital que usted eligió si podemos, y también trataremos de llamar a sus contactos de emergencia.",
  },

  intervention_target_behaviors: { q: "¿Hay comportamientos que usted y el personal acordaron vigilar?", help: "Está bien dejar esto para que lo llene el personal." },
  intervention_valid_until: { q: "¿Hasta qué fecha está bien?", help: "Si la salta, dura un año." },
  consent_emergency_interventions: {
    q: "Si alguien está a punto de lastimarse, ¿puede el personal intervenir para proteger a todos?",
    consentSimple:
      "El personal siempre intenta hablar primero. Solo si alguien está a punto de lastimarse gravemente, " +
      "esto permite que personal entrenado sujete a la persona con cuidado para evitarlo. Puede cancelar esto cuando quiera.",
  },

  consent_treatment_plan_participation: {
    q: "¿Ayudó a hacer su plan de cuidado, y le parece bien?",
    consentSimple:
      "Esto dice que usted habló con el personal sobre su plan de cuidado y le gusta el rumbo. " +
      "Si alguna vez quiere cambios, solo díganos - es su plan.",
  },
  consent_receipt_treatment_plan: {
    q: "¿Recibió una copia de su plan de cuidado?",
    consentSimple:
      "Esto dice que recibió su propia copia de su plan de cuidado y que lo entiende. " +
      "Pregúntenos cuando quiera si algo no está claro.",
  },

  hipaa_understood: { q: "¿Le explicamos cómo protegemos su información de salud, y pudo hacer preguntas?" },
  hipaa_copy: { q: "¿Recibió una copia de ese papel?" },
  consent_hipaa: {
    q: "¿Entiende cómo mantenemos privada su información de salud?",
    consentSimple:
      "Esto dice que mantenemos privada su información de salud. Solo la compartimos cuando la ley lo permite. " +
      "Puede ver sus registros cuando quiera.",
  },

  consent_confidentiality: {
    q: "¿Entiende las pocas veces en que la ley nos deja compartir su información?",
    consentSimple:
      "Mantenemos su información privada. La ley solo nos deja compartirla en casos especiales - " +
      "como una orden de la corte, o para proteger a alguien en una emergencia. " +
      "Si alguna vez cree que la compartimos mal, llame al 336-285-5204 y le escucharemos.",
  },

  welcome_letter_ack: { q: "¿Recibió nuestra carta de bienvenida?", help: "Tiene nuestros horarios y nuestra línea de ayuda: 336-285-5204." },

  consent_cca: {
    q: "¿Se reunió con nuestro clínico, y lo que escribimos coincide con lo que usted dijo?",
    consentSimple:
      "Esto dice que usted se reunió con nuestro clínico y que las notas coinciden con lo que le contó. " +
      "Sus necesidades pueden cambiar con el tiempo, y su plan puede cambiar con ellas.",
  },

  consent_tailored_plan: {
    q: "Si su seguro no paga el cuidado que necesita, ¿podemos cambiarle a un plan que sí lo pague?",
    consentSimple:
      "A veces un plan de seguro no paga un servicio que su doctor dice que usted necesita. " +
      "Esto nos deja cambiarle a un plan que sí lo cubra, para que nada se interponga en su cuidado.",
  },

  ...emergencyContactEntriesEs(),
  ...substanceEntriesEs(),
  ...roiEntriesEs(),
  ...surveyEntriesEs(),
  ...referralEntriesEs(),
  ...moodEntriesEs(),
};

/* ------------------------------------------------------------------ */
/* Section intros                                                      */
/* ------------------------------------------------------------------ */

export const SECTION_INTROS_ES: Record<string, string> = {
  mood_check: "Ahora unas preguntas sobre cómo se ha SENTIDO las últimas 2 semanas. No hay respuestas incorrectas.",
  welcome: "¡Hola! Vamos a empezar. Vaya a su propio ritmo - sus respuestas se guardan.",
  basic: "Primero, un poco sobre usted.",
  demographics: "Unas preguntas rápidas más sobre usted.",
  contact: "¿Cómo podemos comunicarnos con usted?",
  insurance: "Hablemos de cómo se paga su cuidado.",
  referral: "¿Quién le mandó con nosotros?",
  services: "¿Qué tipo de ayuda le suena bien?",
  presenting: "Esta es la importante - solo cuéntenos su historia.",
  snap: "Cuéntenos qué le hace ser usted.",
  mental_health: "¿Cómo se ha sentido?",
  medical: "Ahora un poco sobre su salud y su doctor.",
  medications: "¿Qué medicinas toma?",
  legal: "Unas preguntas legales rápidas. Las respuestas honestas ayudan - nadie se mete en problemas.",
  emergency: "¿A quién llamamos si alguna vez necesita ayuda rápido?",
  substance: "Ahora unas preguntas honestas. Aquí nadie juzga - nunca.",
  provider_choice: "Usted elige quién le ayuda.",
  orientation: "Así funciona nuestro programa.",
  rights: "Usted tiene derechos. Aquí están.",
  treatment_consent: "Decir que sí a recibir ayuda.",
  crisis: "La ayuda siempre está a una llamada de distancia.",
  roi: "¿Con quién podemos hablar de su cuidado? Solo con quien USTED diga.",
  transport: "¿Necesita transporte a sus visitas? Podemos ayudar.",
  emergency_care: "Qué hacemos si alguna vez se enferma o se lastima.",
  interventions: "Cómo mantenemos a todos seguros.",
  treatment_plan: "Su plan de cuidado es suyo - usted ayuda a construirlo.",
  hipaa: "Su información de salud se queda privada.",
  confidentiality: "Las pocas veces en que la ley dice que podemos compartir información.",
  welcome_letter: "Un saludo de nuestro equipo.",
  survey: "¿Cómo lo hicimos hasta ahora? Sea honesto/a - nos ayuda a mejorar.",
  referrals: "¿Conoce a alguien más que necesite nuestra ayuda?",
  cca: "Una última firma sobre su evaluación.",
  tailored_plan: "Asegurando que el seguro nunca bloquee su cuidado.",
};

/* ------------------------------------------------------------------ */
/* Encouragements                                                      */
/* ------------------------------------------------------------------ */

export const ENCOURAGEMENTS_ES: string[] = [
  "¡Lo está haciendo muy bien!",
  "¡Buen trabajo - siga así!",
  "¡Ya casi - no pare!",
  "¡Usted puede!",
  "¡Muy bien hasta ahora!",
  "Un paso a la vez - ¡lo está logrando!",
  "Nos alegra que esté aquí.",
  "Pedir ayuda toma valor. ¡Y usted lo está haciendo!",
  "Siga - ¡está más cerca de lo que cree!",
  "¡Bien hecho! Solo un poco más.",
];

/* ------------------------------------------------------------------ */
/* UI chrome strings (for wiring the language toggle)                  */
/* ------------------------------------------------------------------ */

export const UI_ES: Record<string, string> = {
  "Start": "Empezar",
  "Next": "Siguiente",
  "Back": "Atrás",
  "Skip": "Saltar",
  "Skip for now": "Saltar por ahora",
  "I agree": "Estoy de acuerdo",
  "Read the whole form": "Leer el formulario completo",
  "Send my answers": "Enviar mis respuestas",
  "Sign here": "Firme aquí",
  "Parent or guardian signs here": "El padre o tutor firma aquí",
  "Saved": "Guardado",
  "Not saved. Check connection.": "No se guardó. Revise su conexión.",
  "Speak": "Hablar",
  "Stop": "Parar",
  "Use this answer": "Usar esta respuesta",
  "Discard": "Descartar",
  "Tap anywhere to keep going": "Toque en cualquier lugar para seguir",
  "One last thing": "Una última cosa",
  "Last step!": "¡Último paso!",
  "Almost done!": "¡Ya casi termina!",
  "Two quick photos": "Dos fotos rápidas",
  "Next: sign my name": "Siguiente: firmar mi nombre",
  "We still need a few things:": "Todavía nos faltan algunas cosas:",
  "We could not send your answers.": "No pudimos enviar sus respuestas.",
  "Take me to the first one": "Lléveme a la primera",
};
