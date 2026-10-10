import { isDomainError } from "@studio/domain";
import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@/features/scenes";
import { getContainer } from "@/server/container";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = getContainer();
  const project = await container.getProject(id).catch((error: unknown) => {
    if (isDomainError(error) && error.code === "PROJECT_NOT_FOUND") notFound();
    throw error;
  });

  return (
    <ProjectWorkspace
      project={project}
      ttsAvailable={container.listTtsVoices !== null}
      aiAvailable={container.requestAiTask !== null}
    />
  );
}
