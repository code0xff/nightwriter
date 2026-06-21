import { useEffect, useState } from "react";
import { Download, FileClock, Loader2, Trash2 } from "lucide-react";
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
import { deleteHistory, historyDownloadUrl, listHistory } from "@/lib/api";

export function HistoryPanel() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setItems((await listHistory()).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const remove = async (id: string) => {
    setPendingId(id);
    try {
      await deleteHistory(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
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
          Your past generations are kept permanently and re-downloadable.
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
            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
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
            <div className="flex shrink-0 gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={historyDownloadUrl(it.id)} download>
                  <Download />
                  Download
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(it.id)}
                disabled={pendingId === it.id}
                aria-label="Delete"
              >
                {pendingId === it.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
