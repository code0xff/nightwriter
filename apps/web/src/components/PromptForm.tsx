import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { GenerateRequest, GeneratorCli, Target } from "@nightwriter/shared";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GENERATORS, TARGET_OPTIONS, generatorById } from "@/lib/catalog";

interface Props {
  disabled?: boolean;
  onSubmit: (req: GenerateRequest) => void;
}

export function PromptForm({ disabled, onSubmit }: Props) {
  const [prompt, setPrompt] = useState("");
  const [cli, setCli] = useState<GeneratorCli>("claude");
  const [model, setModel] = useState<string>(GENERATORS[0]!.models[0]!.id);
  const [target, setTarget] = useState<Target>("claude");

  const generator = useMemo(() => generatorById(cli), [cli]);

  const handleCli = (next: string) => {
    const g = generatorById(next as GeneratorCli);
    setCli(g.id);
    setModel(g.models[0]!.id);
  };

  const canSubmit = prompt.trim().length > 0 && !disabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Describe your agent</CardTitle>
        <CardDescription>
          Nightwriter runs the selected CLI to generate a runtime-ready agent
          definition and an install script.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="prompt">Prompt</Label>
          <Textarea
            id="prompt"
            value={prompt}
            disabled={disabled}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A meticulous code-review agent that flags security issues, checks tests, and proposes minimal diffs."
            className="min-h-28 font-mono"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Generator CLI</Label>
            <Select value={cli} onValueChange={handleCli} disabled={disabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENERATORS.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                    <span className="ml-2 font-mono text-muted-foreground">
                      {g.command}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onValueChange={setModel} disabled={disabled}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {generator.models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                    <span className="ml-2 font-mono text-muted-foreground">
                      {m.id}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Target runtime</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TARGET_OPTIONS.map((t) => {
              const active = t.id === target;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTarget(t.id)}
                  className={cn(
                    "rounded-md border border-input bg-card px-3 py-2 text-left transition-colors",
                    "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                    active && "border-primary ring-1 ring-ring",
                  )}
                >
                  <div className="text-xs font-medium">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                prompt: prompt.trim(),
                generator: { cli, model },
                target,
              })
            }
          >
            <Sparkles />
            Generate agent
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
