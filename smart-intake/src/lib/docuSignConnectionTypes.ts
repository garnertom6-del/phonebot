export type DocuSignEnvironment = "sandbox" | "production" | "automatic";

export type DocuSignConnection = {
  configured: boolean;
  environment: DocuSignEnvironment;
  status: "not_checked" | "connected" | "needs_setup" | "failed";
  message: string;
  missing: string[];
  checkedAt?: string;
  accountName?: string;
};
