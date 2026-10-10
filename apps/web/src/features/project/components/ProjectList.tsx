import type { ProjectSummary } from "@studio/services";
import Link from "next/link";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { MODE_LABELS } from "../labels";
import { DeleteProjectButton } from "./DeleteProjectButton";

const dateFormat = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
        <p className="text-muted-foreground">Chưa có dự án nào.</p>
        <Button asChild>
          <Link href="/projects/new">Tạo dự án đầu tiên</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {projects.map((project) => (
        <li key={project.id}>
          <Card className="relative transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="min-w-0 truncate">
                  {/* The link covers the whole card; the delete button sits above it. */}
                  <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0">
                    {project.name}
                  </Link>
                </CardTitle>
                <div className="relative z-10 flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">{MODE_LABELS[project.mode].title}</Badge>
                  <DeleteProjectButton project={project} after="refresh" compact />
                </div>
              </div>
              <CardDescription>
                {project.sceneCount} cảnh · Sửa lúc {dateFormat.format(new Date(project.updatedAt))}
              </CardDescription>
            </CardHeader>
          </Card>
        </li>
      ))}
    </ul>
  );
}
