import { isDomainError } from "@studio/domain";
import { notFound, redirect } from "next/navigation";

import { FullAiStudio } from "@/features/full-ai";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export default async function FullAiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = getContainer();
  const project = await container.getProject(id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "PROJECT_NOT_FOUND") notFound();
    throw error;
  });
  // Without an AI provider the feature is hidden (rule 5): back to the editor.
  if (container.requestFullAi === null) redirect(`/projects/${encodeURIComponent(id)}`);

  return (
    <FullAiStudio
      project={project}
      savedDraft={await container.getFullAiDraft(id)}
      skills={await container.listSkills()}
      ttsAvailable={container.listTtsVoices !== null}
    />
  );
}
