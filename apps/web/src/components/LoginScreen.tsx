import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck, UserPlus } from "lucide-react";
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
import { login, register } from "@/lib/authApi";
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
          <CardTitle className="text-sm">Account</CardTitle>
          <CardDescription>
            New accounts need an admin to approve them before first sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="pt-3">
              <SignIn onSession={setSession} />
            </TabsContent>
            <TabsContent value="register" className="pt-3">
              <Register />
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
  return err instanceof Error ? err.message : String(err);
}

function SignIn({
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
      onSession(await login(username.trim(), password));
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
      <Field
        id="login-username"
        label="Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
      />
      <Field
        id="login-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
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

function Register() {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await register(username.trim(), password, displayName.trim() || undefined);
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
          Account created. An admin must activate it before you can sign in.
        </AlertDescription>
      </Alert>
    );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <Field
        id="reg-username"
        label="Username"
        value={username}
        onChange={setUsername}
        placeholder="jane"
        autoComplete="username"
      />
      <Field
        id="reg-display"
        label="Display name (optional)"
        value={displayName}
        onChange={setDisplayName}
        placeholder="Jane Doe"
      />
      <Field
        id="reg-password"
        label="Password (min 8 chars)"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
      />
      <Button
        className="w-full"
        type="submit"
        disabled={busy || username.trim().length < 3 || password.length < 8}
      >
        {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Create account
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function Field(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
      />
    </div>
  );
}
