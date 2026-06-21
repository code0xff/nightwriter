import { useState } from "react";
import { IdCard, KeyRound, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { changePassword, updateDisplayName } from "@/lib/authApi";
import { useAuth } from "@/lib/authContext";

type Msg = { ok: boolean; text: string } | null;

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="space-y-4">
      <DisplayNameCard />
      {user.hasPassword && <PasswordCard />}
    </div>
  );
}

function DisplayNameCard() {
  const { user, updateUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const current = user?.displayName ?? "";
  const trimmed = displayName.trim();
  const unchanged = trimmed === current;

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await updateDisplayName(trimmed);
      updateUser(updated);
      setDisplayName(updated.displayName);
      setMsg({ ok: true, text: "Display name updated." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Display name</CardTitle>
        <CardDescription>
          The name shown across the app. Signed in as{" "}
          <code>{user?.username}</code>.
        </CardDescription>
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
            <Label htmlFor="acct-display-name">Display name</Label>
            <Input
              id="acct-display-name"
              autoComplete="nickname"
              maxLength={64}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !trimmed || unchanged}>
              {busy ? <Loader2 className="animate-spin" /> : <IdCard />}
              Update display name
            </Button>
          </div>
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

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await changePassword(current, next);
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
        <CardTitle className="text-sm">Change password</CardTitle>
        <CardDescription>
          Confirm your current password to set a new one.
        </CardDescription>
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
            <Label htmlFor="acct-cur-pw">Current password</Label>
            <Input
              id="acct-cur-pw"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acct-new-pw">New password (min 8 chars)</Label>
            <Input
              id="acct-new-pw"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !current || next.length < 8}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Update password
            </Button>
          </div>
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
