export type NewIntakeReadinessInput = {
  fullName?: string;
  dob?: string;
  contactReady: boolean;
  recordReady?: boolean;
  packetContextLoaded: boolean;
  packetContextError?: boolean;
  packetReady: boolean;
};

export type NewIntakeReadinessItem = {
  key: "identity" | "contact";
  label: string;
  ready: boolean;
  help: string;
};

export function buildNewIntakeReadiness(input: NewIntakeReadinessInput) {
  const identityReady = (input.fullName || "").trim().length >= 2 && !!(input.dob || "").trim();
  const items: NewIntakeReadinessItem[] = [
    {
      key: "identity",
      label: "Client identity",
      ready: identityReady,
      help: identityReady ? "Name and date of birth added" : "Add name and date of birth",
    },
    {
      key: "contact",
      label: "Delivery contact",
      ready: input.contactReady,
      help: input.contactReady ? "Valid phone or email added" : "Add a valid phone or email",
    },
  ];
  const completedRequired = items.filter((item) => item.ready).length;
  const totalRequired = items.length;
  const ready = completedRequired === totalRequired;
  const packet = input.packetContextError
    ? { label: "Provider context unavailable", tone: "warning" as const }
    : !input.packetContextLoaded
    ? { label: "Checking packet status", tone: "neutral" as const }
    : input.packetReady
      ? { label: "Approved packet ready", tone: "success" as const }
      : { label: "Answer collection only — packet setup pending", tone: "warning" as const };

  return {
    items,
    completedRequired,
    totalRequired,
    ready,
    title: ready ? "Ready to create the secure link" : `Finish ${totalRequired - completedRequired} required step${totalRequired - completedRequired === 1 ? "" : "s"}`,
    packet,
  };
}

/** Primary create-button copy. SMS texting is opt-in only. */
export function newIntakeCreateLabel(input: {
  isCreating?: boolean;
  packetContextError?: boolean;
  hasSmsPhone?: boolean;
  sendSmsAfterCreate?: boolean;
}): string {
  const textNow = !!(input.hasSmsPhone && input.sendSmsAfterCreate);
  if (input.isCreating) return textNow ? "Creating and texting the link..." : "Creating intake...";
  if (input.packetContextError) return "Sign in to create an intake";
  return textNow ? "Create and text the link" : "Create intake";
}
