"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { upsertApplicationAction } from "./actions";

const STATUSES = [
  "interested",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export function StatusPanel({
  jobId,
  current,
}: {
  jobId: number;
  current: string | null;
}) {
  const [pending, start] = useTransition();
  function set(status: string) {
    start(async () => {
      await upsertApplicationAction(jobId, status);
    });
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUSES.map((s) => (
        <Button
          key={s}
          size="sm"
          variant={current === s ? "default" : "outline"}
          onClick={() => set(s)}
          disabled={pending}
        >
          {s}
        </Button>
      ))}
    </div>
  );
}
