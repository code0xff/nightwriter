import { type ReactNode, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileClock,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";
import type { HistoryItem } from "@nightwriter/shared";
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
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import {
  deleteHistory,
  getHistoryItem,
  historyDownloadUrl,
  listHistory,
} from "@/lib/api";

export function HistoryPanel() {
  const [selected, setSelected] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (selected)
    return (
      <HistoryDetail
        id={selected}
        onBack={() => setSelected(null)}
        onDeleted={() => {
          setSelected(null);
          setReloadKey((k) => k + 1);
        }}
      />
    );

  return (
    <HistoryList
      key={reloadKey}
      onOpen={setSelected}
      onDeleted={() => setReloadKey((k) => k + 1)}
    />
  );
}

function HistoryList({
  onOpen,
  onDeleted,
}: {
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    listHistory()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (id: string) => {
    setPendingId(id);
    try {
      await deleteHistory(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      onDeleted();
      toast.success("Generation deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileClock className="size-4" /> History
        </CardTitle>
        <CardDescription>
          Click an item to view details. Generations are kept permanently.
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
        {!loading && items.length === 0 && !error && (
          <p className="text-[11px] text-muted-foreground">
            No agents yet — generate one and it will appear here.
          </p>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(it.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpen(it.id);
            }}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors hover:border-foreground/30 hover:bg-accent"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{it.target}</Badge>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {it.generator.cli}
                  {it.generator.model ? ` · ${it.generator.model}` : ""}
                </span>
              </div>
              <p className="truncate text-xs" title={it.prompt}>
                {it.prompt}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(it.createdAt).toLocaleString()} ·{" "}
                {(it.sizeBytes / 1024).toFixed(1)} KB
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild size="sm" variant="outline" aria-label="Download zip">
                <a
                  href={historyDownloadUrl(it.id)}
                  download
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download />
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(it.id);
                }}
                disabled={pendingId === it.id}
              >
                {pendingId === it.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
              </Button>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function HistoryDetail({
  id,
  onBack,
  onDeleted,
}: {
  id: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [item, setItem] = useState<HistoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getHistoryItem(id)
      .then(setItem)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteHistory(id);
      onDeleted();
      toast.success("Generation deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </Button>
          <CardTitle className="text-sm">Generation detail</CardTitle>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {item && (
            <Button asChild size="sm">
              <a href={historyDownloadUrl(item.id)} download>
                <Download />
                Download zip
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!item && !error && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
        {item && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{item.target}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.generator.cli}
                {item.generator.model ? ` · ${item.generator.model}` : ""}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {new Date(item.createdAt).toLocaleString()} ·{" "}
                {(item.sizeBytes / 1024).toFixed(1)} KB
              </span>
            </div>

            <Field label="Prompt">
              <p className="whitespace-pre-wrap text-xs">{item.prompt}</p>
            </Field>

            <Field label="Files">
              <ul className="space-y-1">
                {item.files.map((f) => (
                  <li key={f} className="flex items-center gap-2 font-mono text-xs">
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="break-all">{f}</span>
                  </li>
                ))}
              </ul>
            </Field>

            <Separator />

            <Field label={item.definitionFile ?? "Definition"}>
              {item.definition ? (
                <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {item.definition}
                </pre>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  (definition not stored for this item)
                </p>
              )}
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
