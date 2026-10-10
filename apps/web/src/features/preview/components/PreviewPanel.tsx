"use client";

import type { PlayerRef } from "@remotion/player";
import dynamic from "next/dynamic";
import type { RefObject } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

import type { PreviewPlan } from "../plan";

const PreviewPlayer = dynamic(() => import("./PreviewPlayer").then((module) => module.PreviewPlayer), {
  ssr: false,
  loading: () => <div className="aspect-[9/16] w-full animate-pulse rounded-md bg-muted" />,
});

export function PreviewPanel({
  preview,
  hasScenes,
  playerRef,
}: {
  preview: PreviewPlan;
  hasScenes: boolean;
  playerRef: RefObject<PlayerRef | null>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Xem trước</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasScenes ? (
          <p className="text-sm text-muted-foreground">Thêm cảnh để xem trước video.</p>
        ) : preview.ok ? (
          <PreviewPlayer plan={preview.plan} playerRef={playerRef} />
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
