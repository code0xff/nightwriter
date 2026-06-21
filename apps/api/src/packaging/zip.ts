import { createWriteStream } from "node:fs";
import archiver from "archiver";
import type { ArtifactFile } from "../targets/index.js";

/**
 * Write the given artifact files into a zip at `outPath`.
 * Returns the byte size of the resulting archive.
 */
export function createZip(
  outPath: string,
  files: ArtifactFile[],
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(archive.pointer()));
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    archive.pipe(output);
    for (const file of files) {
      archive.append(file.content, {
        name: file.path,
        mode: file.mode ?? 0o644,
      });
    }
    void archive.finalize();
  });
}
