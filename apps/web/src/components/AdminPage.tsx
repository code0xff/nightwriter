import { useEffect, useState } from "react";
import { Loader2, UserCheck, UserX } from "lucide-react";
import type { AdminUser } from "@nightwriter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { listUsers, setUserActive } from "@/lib/authApi";

export function AdminPage() {
  return (
    <div className="space-y-4">
      <UsersCard />
    </div>
  );
}

function UsersCard() {
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setUsers((await listUsers()).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const toggle = async (u: AdminUser, active: boolean) => {
    setPendingId(u.id);
    try {
      await setUserActive(u.id, active);
      await refresh();
      toast.success(
        `${u.displayName} ${active ? "activated" : "deactivated"}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Users</CardTitle>
        <CardDescription>
          Activate registered users so they can sign in and generate agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {users.map((u) => (
          <div
            key={u.id}
            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="truncate">{u.displayName}</span>
                <Badge variant={u.role === "admin" ? "info" : "secondary"}>
                  {u.role}
                </Badge>
                <Badge variant={u.status === "active" ? "success" : "warning"}>
                  {u.status}
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {[
                  u.hasPassword && "password",
                  u.passkeyCount > 0 && `${u.passkeyCount} passkey(s)`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "no credentials"}
                {" · joined "}
                {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
            {u.role !== "admin" && (
              <div className="flex shrink-0 gap-2">
                {u.status === "pending" ? (
                  <Button
                    size="sm"
                    onClick={() => toggle(u, true)}
                    disabled={pendingId === u.id}
                  >
                    <UserCheck />
                    Activate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggle(u, false)}
                    disabled={pendingId === u.id}
                  >
                    <UserX />
                    Deactivate
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
