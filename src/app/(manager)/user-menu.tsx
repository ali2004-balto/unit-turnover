import { LogOut } from "lucide-react";
import { getCurrentSession } from "@/server/auth/current";
import { logout } from "../login/actions";

export async function UserMenu() {
  const session = await getCurrentSession();
  if (!session) return null;
  return (
    <form action={logout} className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline" title={session.person.email ?? undefined}>
        {session.person.name}
      </span>
      <button
        type="submit"
        className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </form>
  );
}
