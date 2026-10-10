import type { BudgetCheck } from "@studio/domain";
import Link from "next/link";

import { blockedReason, budgetLines } from "../model";

/** Spend against each budget and, when the call would be blocked, why. Shown in every paid-call dialog. */
export function BudgetStatus({ check }: { check: BudgetCheck }) {
  const reason = blockedReason(check);
  return (
    <span className="flex flex-col gap-0.5">
      {budgetLines(check).map((line) => (
        <span key={line} className="text-xs">
          {line}
        </span>
      ))}
      {reason !== null ? (
        <span className="text-destructive" role="alert">
          {reason}{" "}
          <Link className="underline" href="/settings">
            Mở cài đặt ngân sách
          </Link>
        </span>
      ) : null}
    </span>
  );
}
