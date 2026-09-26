import fs from "node:fs";

/**
 * Crash-safe file write (H4 fix): write to `<file>.tmp`, then atomically
 * rename over the target. A crash mid-write used to leave truncated JSON,
 * and every loader's `catch { return [] }` silently returned empty — all
 * memories / reminders / spend state vanished with no error. Now the old
 * file stays intact until the new bytes are fully on disk.
 */
export function atomicWriteFile(file: string, data: string, _encoding?: string): void {
  void _encoding; // always utf-8; param kept for drop-in fs.writeFileSync compat
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, file);
}
