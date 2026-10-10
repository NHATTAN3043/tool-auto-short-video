import Link from "next/link";

import { ProjectList } from "@/features/project";
import { getContainer } from "@/server/container";
import { Button } from "@/shared/ui/button";

// Projects live on disk and change at any time; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await getContainer().listProjects();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dự án</h1>
        <Button asChild>
          <Link href="/projects/new">Tạo dự án</Link>
        </Button>
      </div>
      <ProjectList projects={projects} />
    </div>
  );
}
