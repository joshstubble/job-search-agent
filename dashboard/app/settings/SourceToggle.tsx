"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toggleSourceAction } from "./actions";

export function SourceToggle({
  name,
  enabled,
}: {
  name: string;
  enabled: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={enabled ? "default" : "outline"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleSourceAction(name, !enabled);
        })
      }
    >
      {enabled ? "on" : "off"}
    </Button>
  );
}
