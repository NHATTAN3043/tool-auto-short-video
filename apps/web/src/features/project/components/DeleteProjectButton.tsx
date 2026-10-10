"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/ui/alert-dialog";
import { Button, buttonVariants } from "@/shared/ui/button";

import { useDeleteProject } from "../hooks/use-delete-project";

/**
 * Deletes for good after one confirmation, then reloads the project list (`refresh`) or leaves the deleted
 * project's page (`home`). `compact` is the icon-only button of the project list.
 */
export function DeleteProjectButton({
  project,
  after,
  compact = false,
}: {
  project: { id: string; name: string };
  after: "refresh" | "home";
  compact?: boolean;
}) {
  const router = useRouter();
  const deletion = useDeleteProject(project.id, () => {
    if (after === "home") router.replace("/");
    else router.refresh();
  });
  return (
    <AlertDialog open={deletion.open} onOpenChange={deletion.setOpen}>
      <AlertDialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Xoá dự án ${project.name}`}>
            <Trash2 />
          </Button>
        ) : (
          <Button variant="outline" className="text-destructive">
            <Trash2 />
            Xoá dự án
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Bạn chắc chắn muốn xoá dự án “{project.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Toàn bộ cảnh, media đã tải, giọng và video đã render của dự án sẽ bị xoá vĩnh viễn, không khôi
            phục được. Thư viện media chung và chi phí AI đã ghi nhận vẫn được giữ.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deletion.error ? <p className="text-sm text-destructive">{deletion.error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deletion.busy}>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={deletion.busy}
            onClick={(event) => {
              // Stay open until the server answers, so an error can be shown.
              event.preventDefault();
              void deletion.confirm();
            }}
          >
            {deletion.busy ? "Đang xoá…" : "Xoá vĩnh viễn"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
