import { prisma } from "@/lib/prisma";
import { ClientRightsView } from "@/components/ClientRightsView";

export default async function ClientRightsPage(props: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ mode?: string | string[] }>;
}) {
  const params = await props.params;
  const query = await props.searchParams;
  const mode = query?.mode === "full" ? "full" : undefined;
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    select: {
      archived: true,
      provider: { select: { name: true, phone: true, status: true } },
    },
  });

  const liveIntake = intake && !intake.archived && intake.provider && intake.provider.status === "ACTIVE"
    ? intake
    : null;

  if (liveIntake?.provider) {
    return <ClientRightsView provider={liveIntake.provider} token={params.token} mode={mode} />;
  }

  return (
    <ClientRightsView
      mode={mode}
      fallbackNotice="This intake link is not available, but you can still read your rights and privacy information here."
    />
  );
}
