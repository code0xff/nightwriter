import { describe, expect, it } from "vitest";
import { maskSecrets } from "../src/util/logger.js";

describe("maskSecrets", () => {
  it("fully removes token-shaped secrets (no leak of the original)", () => {
    const secret = "sk-ant-api03-ABCDEFGH1234567890";
    const out = maskSecrets(`using key ${secret} now`);
    expect(out).not.toContain(secret);
    expect(out).not.toContain("sk-ant-api03");
    expect(out).toContain("***");
  });

  it("masks generic sk- and GitHub tokens", () => {
    expect(maskSecrets("sk-ABCDEFGH1234567890XY")).not.toMatch(/ABCDEFGH/);
    expect(maskSecrets("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).not.toMatch(
      /ABCDEFGH/,
    );
  });

  it("masks Bearer tokens without leaking the token", () => {
    const out = maskSecrets("send header Bearer abcdef0123456789xyz");
    expect(out).not.toContain("abcdef0123456789");
    expect(out).toContain("Bearer ***");
  });

  it("keeps the key but masks key=value secrets", () => {
    const kv = maskSecrets("api_key=supersecretvalue123");
    expect(kv).toContain("api_key=");
    expect(kv).not.toContain("supersecretvalue");
    expect(kv).toContain("***");
  });

  it("leaves ordinary text untouched", () => {
    expect(maskSecrets("just a normal log line")).toBe("just a normal log line");
  });
});
