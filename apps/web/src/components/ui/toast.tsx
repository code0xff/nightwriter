import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cva } from "class-variance-authority";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "destructive" | "info";

interface ToastOptions {
  /** Optional bold heading shown above the message. */
  title?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4000; pass 0 to keep it sticky. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "title">> {
  id: number;
  title?: string;
  message: string;
}

interface ToastApi {
  toast: (message: string, opts?: ToastOptions) => void;
  success: (message: string, opts?: Omit<ToastOptions, "variant">) => void;
  error: (message: string, opts?: Omit<ToastOptions, "variant">) => void;
  info: (message: string, opts?: Omit<ToastOptions, "variant">) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, opts?: ToastOptions) => {
      const id = (seq.current += 1);
      const duration = opts?.duration ?? DEFAULT_DURATION;
      setToasts((xs) => [
        ...xs,
        {
          id,
          message,
          title: opts?.title,
          variant: opts?.variant ?? "default",
          duration,
        },
      ]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (message, opts) => push(message, { ...opts, variant: "success" }),
      error: (message, opts) =>
        push(message, { ...opts, variant: "destructive" }),
      info: (message, opts) => push(message, { ...opts, variant: "info" }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const toastVariants = cva(
  "pointer-events-auto relative flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-xs shadow-lg backdrop-blur duration-200 animate-in fade-in slide-in-from-top-2",
  {
    variants: {
      variant: {
        default: "border-border bg-card/95 text-card-foreground",
        destructive:
          "border-destructive/50 bg-destructive/10 text-destructive [&_svg]:text-destructive",
        info: "border-info/40 bg-info/10 [color:hsl(var(--info))] [&_svg]:text-info",
        success:
          "border-success/40 bg-success/10 [color:hsl(var(--success))] [&_svg]:text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const ICONS: Record<ToastVariant, typeof Info | null> = {
  default: null,
  success: CheckCircle2,
  destructive: XCircle,
  info: Info,
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
      {toasts.map((t) => {
        const Icon = ICONS[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={cn(toastVariants({ variant: t.variant }), "max-w-sm")}
          >
            {Icon && <Icon className="mt-px size-4 shrink-0" />}
            <div className="min-w-0 flex-1">
              {t.title && <div className="font-medium leading-none">{t.title}</div>}
              <div className={cn("break-words", t.title && "mt-1")}>
                {t.message}
              </div>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
              className="-mr-1 -mt-0.5 shrink-0 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export type { ToastApi, ToastOptions, ToastVariant };
