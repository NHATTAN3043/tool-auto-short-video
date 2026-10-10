import { z } from "zod";

import { DomainError } from "../errors";
import { PROJECT_SCHEMA_VERSION, ProjectSchema, type Project } from "./schema";

/**
 * Turns stored project JSON of any version into the current `Project`. Repositories call this on every
 * read so old projects never break. When the schema changes, add `migrateV1ToV2` and chain it here.
 */
export function migrateProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null) {
    throw new DomainError("INVALID_PROJECT", "Project data must be an object");
  }
  const version: unknown = "schemaVersion" in raw ? raw.schemaVersion : undefined;
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new DomainError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Unsupported project schemaVersion: ${version === undefined ? "missing" : JSON.stringify(version)}`,
    );
  }
  const result = ProjectSchema.safeParse(raw);
  if (!result.success) throw new DomainError("INVALID_PROJECT", z.prettifyError(result.error));
  return result.data;
}
