"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { newTvLinkAction, removeTvLinkAction } from "./actions";

function Submit({ children, variant = "secondary" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {children}
    </Button>
  );
}

export function MakeTvLinkButton({ replace = false }: { replace?: boolean }) {
  return (
    <form
      action={newTvLinkAction}
      onSubmit={(e) => {
        if (replace && !confirm("Make a new link? The current one stops working, so the TV will need the new link.")) e.preventDefault();
      }}
    >
      <Submit variant={replace ? "secondary" : "primary"}>{replace ? "Make a new link" : "Make a link"}</Submit>
    </form>
  );
}

export function TurnOffTvButton() {
  return (
    <form
      action={removeTvLinkAction}
      onSubmit={(e) => {
        if (!confirm("Turn the link off? The TV stops showing the board.")) e.preventDefault();
      }}
    >
      <Submit variant="ghost">Turn off</Submit>
    </form>
  );
}
