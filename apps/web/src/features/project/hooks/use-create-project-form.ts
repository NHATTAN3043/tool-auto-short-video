"use client";

import type { AutomationMode, AutomationSettings } from "@studio/domain";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createProject } from "../api";
import { nameError, newDraft, selectMode, toCreateInput, toggleSetting } from "../model";

export function useCreateProjectForm() {
  const router = useRouter();
  const [draft, setDraft] = useState(newDraft);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = nameError(draft.name);

  async function submit() {
    setSubmitted(true);
    if (validation) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(toCreateInput(draft));
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được dự án.");
      setSubmitting(false);
    }
  }

  return {
    draft,
    nameError: submitted ? validation : null,
    submitting,
    error,
    setName: (name: string) => {
      setDraft((d) => ({ ...d, name }));
    },
    selectMode: (mode: AutomationMode) => {
      setDraft((d) => selectMode(d, mode));
    },
    toggle: (key: keyof AutomationSettings, value: boolean) => {
      setDraft((d) => toggleSetting(d, key, value));
    },
    submit,
  };
}
