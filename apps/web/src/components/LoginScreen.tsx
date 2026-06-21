import { useState } from "react";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, UserPlus } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api";
import {
  adminLogin,
  loginPasskey,
  registerPasskey,
} from "@/lib/authApi";
import { useAuth } from "@/lib/authContext";

export function LoginScreen() {
  const { setSession } = useAuth();
  return (
    <div className="mx-auto max-w-md space-y-4 pt-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Nightwriter</h1>
        <p className="text-xs text-muted-foreground">
          Sign in to generate and manage your agents.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Authentication</CardTitle>
          <CardDescription>Passkey for users, password for admins.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
              <TabsTrigger value="admin">Admin</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="pt-3">
              <SignIn onSession={setSession} />
            </TabsContent>
            <TabsContent value="register" className="pt-3">
              <Register />
            </TabsContent>
            <TabsContent value="admin" className="pt-3">
              <AdminLogin onSession={setSession} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "pending_activation")
      return "Your account is awaiting admin approval.";
    return err.message;
  }
  if (err instanceof Error && err.name === "NotAllowedError")
    return "Passkey prompt was dismissed.";
  return err instanceof Error ? err.message : String(err);
}

function SignIn({ onSession }: { onSession: ReturnType<typeof useAuth>["setSession"] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onSession(await loginPasskey());
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Use the passkey on this device.
      </p>
      <Button className="w-full" onClick={go} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />}
        Sign in with passkey
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function Register() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey(username.trim(), displayName.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Alert variant="success">
        <ShieldCheck />
        <AlertDescription>
          Passkey registered. An admin must activate your account before you can
          sign in.
        </AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="reg-username">Username</Label>
        <Input
          id="reg-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="jane"
          autoComplete="username"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reg-display">Display name (optional)</Label>
        <Input
          id="reg-display"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jane Doe"
        />
      </div>
      <Button
        className="w-full"
        onClick={go}
        disabled={busy || username.trim().length < 3}
      >
        {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Create passkey
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function AdminLogin({
  onSession,
}: {
  onSession: ReturnType<typeof useAuth>["setSession"];
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onSession(await adminLogin(username.trim(), password));
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="admin-username">Username</Label>
        <Input
          id="admin-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin-password">Password</Label>
        <Input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <Button className="w-full" type="submit" disabled={busy || !username || !password}>
        {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
        Sign in
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
