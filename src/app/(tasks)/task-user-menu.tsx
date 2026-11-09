import Link from "next/link";
import { getTaskUser } from "@/server/auth/current";
import { signOutOfTasks } from "../signin/actions";

export async function TaskUserMenu() {
  const user = await getTaskUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="max-w-32 truncate text-muted-foreground">{user.person.name}</span>
      {user.via === "link" ? (
        <form action={signOutOfTasks}>
          <button type="submit" className="h-10 rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            Sign out
          </button>
        </form>
      ) : (
        <Link href="/" className="h-10 content-center rounded-md px-2 text-primary hover:bg-muted">
          Dashboard
        </Link>
      )}
    </div>
  );
}
