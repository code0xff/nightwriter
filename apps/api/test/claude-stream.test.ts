import { describe, expect, it } from "vitest";
import { createClaudeAdapter } from "../src/adapters/claude.js";

const parser = () => createClaudeAdapter("claude").createStreamParser!();
const ev = (o: unknown) => JSON.stringify(o);

describe("claude stream parser", () => {
  it("surfaces live logs and extracts the definition from the result event", () => {
    const p = parser();
    expect(p.onLine(ev({ type: "system", subtype: "init", model: "haiku" }))).toEqual([
      "session started (haiku)",
    ]);
    expect(
      p.onLine(
        ev({
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "thinking" } },
        }),
      ),
    ).toEqual(["thinking…"]);
    // text is streamed to logs line by line
    expect(
      p.onLine(
        ev({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello\nwor" } },
        }),
      ),
    ).toEqual(["hello"]);
    // hook/system noise and non-JSON are ignored
    expect(p.onLine(ev({ type: "system", subtype: "hook_started" }))).toEqual([]);
    expect(p.onLine("not json")).toEqual([]);
    // the result event flushes the buffered line + a summary, and yields the definition
    const out = p.onLine(
      ev({ type: "result", subtype: "success", result: "DEF", usage: { output_tokens: 7 } }),
    );
    expect(out).toContain("wor");
    expect(out.some((l) => l.includes("generated"))).toBe(true);
    expect(p.result()).toBe("DEF");
  });

  it("falls back to accumulated text when there is no result event", () => {
    const p = parser();
    p.onLine(
      ev({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "ABC" } },
      }),
    );
    expect(p.result()).toBe("ABC");
  });

  it("fails closed on an error result (does not package partial output)", () => {
    const p = parser();
    p.onLine(
      ev({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } },
      }),
    );
    const out = p.onLine(
      ev({ type: "result", subtype: "error_max_turns", is_error: true, result: "boom" }),
    );
    expect(out.some((l) => l.startsWith("✗"))).toBe(true);
    expect(p.result()).toBe(""); // not the partial text
    expect(p.errorMessage!()).toBe("boom");
  });
});
