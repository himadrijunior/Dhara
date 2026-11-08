import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

/**
 * Storage path validation — the sanitizer (`safeObjectPath`) is module-private,
 * so it is exercised through the exported `storagePut` with node:fs mocked.
 * No real disk I/O happens; we assert the exact paths handed to the fs layer.
 * Actual behavior under test:
 *  - "." and ".." segments are dropped (traversal neutralized)
 *  - leading "/" on absolute paths is dropped (always relative to the bucket root)
 *  - backslashes are NOT separators — they are replaced with "_"
 *  - empty/dot-only paths are rejected with DharaError("bad_path")
 *  - projectId/bucket are sanitized the same way
 */

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(async (..._args: unknown[]) => undefined),
  writeFileMock: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("node:fs/promises", () => ({
  default: { mkdir: mkdirMock, writeFile: writeFileMock },
}));

vi.mock("@/lib/server/config", () => ({
  readConfig: vi.fn(async () => null), // → local driver
  STORAGE_DIR: "/tmp/dhara-test-storage",
}));

const { storagePut } = await import("@/lib/server/storage");
import { DharaError } from "@/lib/server/oracle";

const ROOT = path.join("/tmp/dhara-test-storage", "proj1", "bucket1");

function lastWritePath(): string {
  const calls = writeFileMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as string;
}

beforeEach(() => {
  mkdirMock.mockClear();
  writeFileMock.mockClear();
});

describe("storagePut — object path sanitization", () => {
  it("writes a normal path inside the bucket root", async () => {
    await storagePut("proj1", "bucket1", "docs/readme.txt", Buffer.from("hi"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, "docs", "readme.txt"));
    expect(mkdirMock).toHaveBeenCalledWith(path.dirname(path.join(ROOT, "docs", "readme.txt")), { recursive: true });
  });

  it("neutralizes parent-directory traversal (../)", async () => {
    await storagePut("proj1", "bucket1", "../evil.txt", Buffer.from("x"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, "evil.txt"));
    expect(lastWritePath().startsWith(ROOT + path.sep)).toBe(true);
  });

  it("neutralizes multi-segment traversal (a/../../escape.txt)", async () => {
    await storagePut("proj1", "bucket1", "a/../../escape.txt", Buffer.from("x"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, "a", "escape.txt"));
    expect(lastWritePath().startsWith(ROOT + path.sep)).toBe(true);
  });

  it("collapses absolute paths to paths inside the bucket root", async () => {
    await storagePut("proj1", "bucket1", "/etc/passwd", Buffer.from("x"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, "etc", "passwd"));
  });

  it("treats backslashes as plain characters (no separator traversal)", async () => {
    await storagePut("proj1", "bucket1", "..\\..\\evil.txt", Buffer.from("x"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, ".._.._evil.txt"));
    expect(lastWritePath().startsWith(ROOT + path.sep)).toBe(true);
  });

  it("replaces illegal characters in file names with underscores", async () => {
    await storagePut("proj1", "bucket1", "hello world%.txt", Buffer.from("x"), "text/plain");
    expect(lastWritePath()).toBe(path.join(ROOT, "hello_world_.txt"));
  });

  it("rejects empty and dot-only paths", async () => {
    for (const bad of ["", ".", ".."]) {
      await expect(
        storagePut("proj1", "bucket1", bad, Buffer.from("x"), "text/plain")
      ).rejects.toThrowError(DharaError);
      await expect(
        storagePut("proj1", "bucket1", bad, Buffer.from("x"), "text/plain")
      ).rejects.toMatchObject({ code: "bad_path" });
    }
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("sanitizes projectId and bucket as well, keeping writes inside STORAGE_DIR", async () => {
    await storagePut("p/../../r", "b/../ucket", "f.txt", Buffer.from("x"), "text/plain");
    const sanitizedRoot = path.join("/tmp/dhara-test-storage", "pr", "bucket");
    expect(lastWritePath()).toBe(path.join(sanitizedRoot, "f.txt"));
    expect(lastWritePath().startsWith("/tmp/dhara-test-storage" + path.sep)).toBe(true);
  });
});
