import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, UserCheck, UserX } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeAdminPassword, listUsers, setUserActive } from "@/lib/authApi";

export function AdminPage() {
  return (
    <div className="space-y-4">
      <UsersCard />
      <PasswordCard />
    </div>
  );
}

function UsersCard() {
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
                joined {new Date(u.createdAt).toLocaleDateString()}
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

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await changeAdminPassword(current, next);
      setMsg({ ok: true, text: "Password updated." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Change admin password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input
              id="cur-pw"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password (min 8 chars)</Label>
            <Input
              id="new-pw"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !current || next.length < 8}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Update password
          </Button>
          {msg && (
            <Alert variant={msg.ok ? "success" : "destructive"}>
              <AlertDescription>{msg.text}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
