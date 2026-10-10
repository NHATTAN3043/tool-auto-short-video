"use client";

import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { BudgetSettingsState } from "../hooks/use-budget-settings";
import { BUDGET_FIELDS, formatDateTime, formatLimit } from "../model";

function statusText(state: BudgetSettingsState): string {
  if (state.status === "saving") return "Đang lưu…";
  if (state.dirty) return "Có thay đổi chưa lưu";
  if (state.status === "saved") return "Đã lưu";
  return state.view.updatedAt
    ? `Lưu lần cuối ${formatDateTime(state.view.updatedAt)}`
    : "Đang dùng giá trị mặc định (.env)";
}

/** Budgets for every paid call (AI and voice). Empty field = no limit; 0 blocks every paid call. */
export function BudgetSettingsForm({ state }: { state: BudgetSettingsState }) {
  const { form, view } = state;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ngân sách</CardTitle>
        <CardDescription>
          Mọi lệnh gọi trả phí (AI, tạo giọng) đều được kiểm tra trước khi chạy; vượt ngân sách thì bị chặn.
          Để trống nếu không giới hạn, nhập 0 để chặn hết.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {BUDGET_FIELDS.map((field) => {
            const id = `budget-${field.key}`;
            const error = state.errors[field.key];
            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label htmlFor={id}>{field.label} (USD)</Label>
                <Input
                  id={id}
                  inputMode="decimal"
                  placeholder="Không giới hạn"
                  value={form[field.key]}
                  aria-invalid={error !== undefined}
                  onChange={(event) => {
                    state.setField(field.key, event.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {field.hint} Mặc định: {formatLimit(view.defaults[field.key])}.
                </p>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </div>
            );
          })}
        </div>

        {state.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {statusText(state)}
          </span>
          <Button variant="outline" onClick={state.resetToDefaults}>
            Về mặc định
          </Button>
          <Button
            disabled={!state.dirty || state.status === "saving"}
            onClick={() => {
              void state.save();
            }}
          >
            Lưu
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
