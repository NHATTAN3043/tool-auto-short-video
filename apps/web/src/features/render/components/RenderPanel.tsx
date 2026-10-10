"use client";

import { reviewProject, type Project, type RenderJob } from "@studio/domain";
import { DownloadIcon, FilmIcon, LoaderIcon, PackageIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";

import { projectFileUrl } from "@/features/media/api";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

import { useRenderJobs } from "../hooks/use-render-jobs";
import {
  downloadName,
  HISTORY_LIMIT,
  isActive,
  KIND_LABELS,
  kindOf,
  STATUS_LABELS,
  warningMessages,
} from "../jobs";

function Downloads({ project, job }: { project: Project; job: RenderJob }) {
  if (job.status !== "COMPLETED" || job.outputPath === undefined) return null;
  const capcut = kindOf(job) === "capcut";
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm">
        <a
          href={projectFileUrl(project.id, job.outputPath)}
          download={downloadName(project.name, job, capcut ? "zip" : "mp4")}
        >
          <DownloadIcon />
          {capcut ? "Tải gói CapCut (.zip)" : "Tải MP4"}
        </a>
      </Button>
      {job.srtPath !== undefined ? (
        <Button asChild size="sm" variant="outline">
          <a href={projectFileUrl(project.id, job.srtPath)} download={downloadName(project.name, job, "srt")}>
            <DownloadIcon />
            Tải phụ đề SRT
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function JobRow({ project, job }: { project: Project; job: RenderJob }) {
  const time = new Date(job.createdAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {KIND_LABELS[kindOf(job)]} · {time}
        </span>
        <Badge
          variant={
            job.status === "FAILED" ? "destructive" : job.status === "COMPLETED" ? "secondary" : "outline"
          }
        >
          {STATUS_LABELS[job.status]}
        </Badge>
      </div>
      {isActive(job) ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${String(job.progress * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs">{Math.round(job.progress * 100)}%</span>
        </div>
      ) : null}
      {job.status === "FAILED" && job.errorMessage ? (
        <p className="text-xs break-words text-destructive">{job.errorMessage}</p>
      ) : null}
      <Downloads project={project} job={job} />
    </li>
  );
}

/** Starts a render in the worker, shows its progress and offers the MP4 and SRT when it is done. */
export function RenderPanel({ project, flushSave }: { project: Project; flushSave: () => Promise<void> }) {
  const renders = useRenderJobs(project.id, flushSave);
  const warnings = useMemo(() => warningMessages(reviewProject(project), project.scenes), [project]);
  const busy = renders.starting || renders.active !== undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Xuất video</CardTitle>
        <CardDescription>
          MP4 1080×1920 (H.264/AAC) kèm phụ đề SRT. “Xuất cho CapCut” tạo gói ZIP gồm video không phụ đề, từng
          track âm thanh, SRT và clip từng cảnh để chỉnh tiếp. Render chạy ở worker, có thể tiếp tục sửa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {warnings.map((text) => (
              <li key={text} className="flex items-start gap-2">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                {text}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            onClick={() => {
              void renders.start("video");
            }}
            disabled={busy || project.scenes.length === 0}
          >
            <FilmIcon />
            Render video
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void renders.start("capcut");
            }}
            disabled={busy || project.scenes.length === 0}
          >
            <PackageIcon />
            Xuất cho CapCut
          </Button>
        </div>
        {renders.active ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            {KIND_LABELS[kindOf(renders.active)]}: {STATUS_LABELS[renders.active.status]}
          </p>
        ) : null}
        {renders.active?.status === "QUEUED" ? (
          <p className="text-xs text-muted-foreground">
            Nếu chờ lâu, kiểm tra worker đang chạy (<code>pnpm dev</code> chạy cả web và worker).
          </p>
        ) : null}

        {renders.error ? (
          <p role="alert" className="text-sm text-destructive">
            {renders.error}
          </p>
        ) : null}

        {renders.jobs.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {renders.jobs.slice(0, HISTORY_LIMIT).map((job) => (
              <JobRow key={job.id} project={project} job={job} />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
