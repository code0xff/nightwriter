import { useState } from "react";
import { KeyRound, Loader2, UserCog } from "lucide-react";
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
import { changePassword, updateUsername } from "@/lib/authApi";
import { useAuth } from "@/lib/authContext";

type Msg = { ok: boolean; text: string } | null;

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="space-y-4">
      <UsernameCard />
      {user.hasPassword && <PasswordCard />}
    </div>
  );
}

function UsernameCard() {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const current = user?.username ?? "";
  const trimmed = username.trim();
  const unchanged = trimmed.toLowerCase() === current.toLowerCase();

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await updateUsername(trimmed);
      updateUser(updated);
      setUsername(updated.username);
      setMsg({ ok: true, text: "Username updated." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Username</CardTitle>
        <CardDescription>
          Your sign-in handle. Letters, digits, and <code>. _ -</code> (3–32
          chars).
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
            <Label htmlFor="acct-username">Username</Label>
            <Input
              id="acct-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          {(user?.passkeyCount ?? 0) > 0 && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Heads up: your passkey will keep showing the old name in your
              device / password manager prompt. Sign-in still works — it's only
              a display label baked in when the passkey was created.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !trimmed || unchanged}>
              {busy ? <Loader2 className="animate-spin" /> : <UserCog />}
              Update username
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
