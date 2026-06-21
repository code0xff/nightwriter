import { useMemo, useState } from "react";
import { Bot, Boxes, Feather, PawPrint, Sparkles, Terminal } from "lucide-react";
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
import { GENERATORS, TARGET_OPTIONS, generatorById } from "@/lib/catalog";

const TARGET_ICONS: Record<Target, typeof Bot> = {
  claude: Bot,
  codex: Terminal,
  openclaw: PawPrint,
  hermes: Feather,
  adk: Boxes,
};

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
  const activeTarget = useMemo(
    () => TARGET_OPTIONS.find((t) => t.id === target) ?? TARGET_OPTIONS[0]!,
    [target],
  );
  const TargetIcon = TARGET_ICONS[target];

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
          <Select
            value={target}
            onValueChange={(v) => setTarget(v as Target)}
            disabled={disabled}
          >
            <SelectTrigger>
              <span className="flex min-w-0 items-center gap-2">
                <TargetIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{activeTarget.label}</span>
              </span>
            </SelectTrigger>
            <SelectContent>
              {TARGET_OPTIONS.map((t) => {
                const Icon = TARGET_ICONS[t.id];
                return (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      {t.label}
                      <span className="ml-1 hidden text-[11px] text-muted-foreground sm:inline">
                        {t.description}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {activeTarget.description}
          </p>
        </div>

        <div className="flex flex-col pt-1 sm:flex-row sm:justify-end">
          <Button
            className="w-full sm:w-auto"
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
