import { spawn } from "node:child_process";

/**
 * True if `bin` launches (i.e. resolves on PATH); false on ENOENT. Runs
 * `<bin> --version` and only distinguishes "found" from "not found" — a binary
 * that exists but errors on --version still counts as available.
 */
export function binResolves(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const child = spawn(bin, ["--version"], { stdio: "ignore" });
      child.on("error", () => done(false)); // ENOENT etc.
      child.on("close", () => done(true));
      const t = setTimeout(() => {
        child.kill();
        done(true);
      }, 5000);
      t.unref?.();
    } catch {
      done(false);
    }
  });
}
