import { describe, expect, it } from "vitest";
import {
  type SessionClaims,
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from "../src/auth/crypto.js";

describe("password hashing", () => {
  it("verifies the correct password and rejects wrong ones", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("produces distinct salted hashes for the same password", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("session tokens", () => {
  const secret = "unit-secret";
  const claims = (exp: number): SessionClaims => ({
    sub: "usr_1",
    role: "user",
    iat: 0,
    exp,
  });

  it("round-trips valid claims", () => {
    const now = 1000;
    const t = signToken(claims(now + 10_000), secret);
    expect(verifyToken(t, secret, now)?.sub).toBe("usr_1");
  });
  it("rejects a tampered payload", () => {
    const t = signToken(claims(10_000), secret);
    const tampered = `x${t}`;
    expect(verifyToken(tampered, secret, 0)).toBeNull();
  });
  it("rejects a wrong secret", () => {
    const t = signToken(claims(10_000), secret);
    expect(verifyToken(t, "other", 0)).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signToken(claims(500), secret);
    expect(verifyToken(t, secret, 1000)).toBeNull();
  });
});
