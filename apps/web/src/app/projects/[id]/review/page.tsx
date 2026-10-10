import { isDomainError } from "@studio/domain";
import { notFound } from "next/navigation";

import { FullAiReview } from "@/features/full-ai";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = getContainer();
  const project = await container.getProject(id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "PROJECT_NOT_FOUND") notFound();
    throw error;
  });
  const latest = await container.getLatestFullAi(id);

  return (
    <FullAiReview
      project={project}
      latest={latest}
      ttsAvailable={container.listTtsVoices !== null}
      aiAvailable={container.requestAiTask !== null}
    />
  );
}
