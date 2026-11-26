import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { BackupEntry, BackupManifest } from "../types/core.js";

export interface DiffValidationResult {
  valid: boolean;
  files: string[];
  reason?: string;
}

export interface PatchApplyResult {
  applied: boolean;
  backupId?: string;
  message: string;
}

export function getDefaultBackupsDir(): string {
  return join(homedir(), ".avilog", "backups");
}

function isInsideCwd(targetPath: string, cwd: string): boolean {
  const absTarget = resolve(targetPath);
  const absCwd = resolve(cwd);
  return absTarget === absCwd || absTarget.startsWith(absCwd.endsWith(sep) ? absCwd : `${absCwd}${sep}`);
}

export function validateUnifiedDiff(diff: string, cwd: string = process.cwd()): DiffValidationResult {
  if (!diff || !diff.includes("@@")) {
    return { valid: false, files: [], reason: "Missing unified diff hunk header (@@ ... @@)" };
  }

  const lines = diff.split(/\r?\n/);
  const files = new Set<string>();
  let hasMinusHeader = false;
  let hasPlusHeader = false;

  for (const line of lines) {
    if (line.startsWith("--- a/")) {
      hasMinusHeader = true;
      const rel = line.slice(6).trim();
      const abs = resolve(cwd, rel);
      if (!isInsideCwd(abs, cwd)) {
        return { valid: false, files: [], reason: `Path traversal blocked: ${rel}` };
      }
      files.add(rel);
    } else if (line.startsWith("+++ b/")) {
      hasPlusHeader = true;
      const rel = line.slice(6).trim();
      const abs = resolve(cwd, rel);
      if (!isInsideCwd(abs, cwd)) {
        return { valid: false, files: [], reason: `Path traversal blocked: ${rel}` };
      }
      files.add(rel);
    }
  }

  if (!hasMinusHeader || !hasPlusHeader || files.size === 0) {
    return { valid: false, files: [], reason: "Missing valid --- a/ and +++ b/ file headers" };
  }

  return { valid: true, files: [...files] };
}

function applyHunksFallback(diff: string, cwd: string): boolean {
  const lines = diff.split(/\r?\n/);
  let currentFile: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
      i++;
      continue;
    }

    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch && currentFile) {
      const targetPath = resolve(cwd, currentFile);
      if (!existsSync(targetPath)) return false;

      const fileLines = readFileSync(targetPath, "utf8").split(/\r?\n/);
      const startLine = Math.max(0, Number(hunkMatch[1]) - 1);
      i++;

      const expectedOld: string[] = [];
      const replacementNew: string[] = [];

      while (i < lines.length) {
        const hLine = lines[i] ?? "";
        if (hLine.startsWith("@@") || hLine.startsWith("diff ") || hLine.startsWith("--- ")) {
          break;
        }
        if (hLine.startsWith(" ")) {
          const content = hLine.slice(1);
          expectedOld.push(content);
          replacementNew.push(content);
        } else if (hLine.startsWith("-")) {
          expectedOld.push(hLine.slice(1));
        } else if (hLine.startsWith("+")) {
          replacementNew.push(hLine.slice(1));
        }
        i++;
      }

      const slice = fileLines.slice(startLine, startLine + expectedOld.length);
      if (slice.join("\n") !== expectedOld.join("\n")) {
        return false;
      }

      fileLines.splice(startLine, expectedOld.length, ...replacementNew);
      writeFileSync(targetPath, fileLines.join("\n"), "utf8");
      continue;
    }

    i++;
  }

  return true;
}

export function applyPatch(
  diff: string,
  cwd: string = process.cwd(),
  backupsDir: string = getDefaultBackupsDir()
): PatchApplyResult {
  const validation = validateUnifiedDiff(diff, cwd);
  if (!validation.valid) {
    return { applied: false, message: validation.reason ?? "Invalid diff" };
  }

  const backupId = `${Date.now()}`;
  const backupFolder = join(backupsDir, backupId);
  mkdirSync(backupFolder, { recursive: true });

  const entries: BackupEntry[] = [];
  for (const rel of validation.files) {
    const absOriginal = resolve(cwd, rel);
    const absBackup = join(backupFolder, rel);
    const existed = existsSync(absOriginal);
    if (existed) {
      mkdirSync(dirname(absBackup), { recursive: true });
      copyFileSync(absOriginal, absBackup);
    }
    entries.push({ originalPath: absOriginal, backupPath: absBackup, existed });
  }

  const manifest: BackupManifest = {
    id: backupId,
    createdAt: new Date().toISOString(),
    entries
  };
  writeFileSync(join(backupFolder, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  // Try git apply first if inside a git repo
  const checkRes = spawnSync("git", ["apply", "--check", "--whitespace=nowarn", "-"], {
    cwd,
    input: diff,
    encoding: "utf8"
  });

  if (checkRes.status === 0) {
    const applyRes = spawnSync("git", ["apply", "--whitespace=nowarn", "-"], {
      cwd,
      input: diff,
      encoding: "utf8"
    });
    if (applyRes.status === 0) {
      return {
        applied: true,
        backupId,
        message: `Patch applied cleanly to ${validation.files.join(", ")} (backup: ${backupId})`
      };
    }
  }

  // Fallback to pure-TS line hunk patcher
  if (applyHunksFallback(diff, cwd)) {
    return {
      applied: true,
      backupId,
      message: `Patch applied via hunk fallback to ${validation.files.join(", ")} (backup: ${backupId})`
    };
  }

  return {
    applied: false,
    backupId,
    message: "Patch failed to apply cleanly (context mismatch); original files untouched."
  };
}

export function undoLastPatch(backupsDir: string = getDefaultBackupsDir()): {
  restored: boolean;
  message: string;
} {
  if (!existsSync(backupsDir)) {
    return { restored: false, message: "No backups directory found." };
  }

  const dirs = readdirSync(backupsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  const latest = dirs[0];
  if (!latest) {
    return { restored: false, message: "No patch backups available to undo." };
  }

  const manifestPath = join(backupsDir, latest, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { restored: false, message: `Backup ${latest} is missing manifest.json.` };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  for (const entry of manifest.entries) {
    if (entry.existed && existsSync(entry.backupPath)) {
      mkdirSync(dirname(entry.originalPath), { recursive: true });
      copyFileSync(entry.backupPath, entry.originalPath);
    } else if (!entry.existed && existsSync(entry.originalPath)) {
      unlinkSync(entry.originalPath);
    }
  }

  return {
    restored: true,
    message: `Restored ${manifest.entries.length} file(s) from backup ${manifest.id}.`
  };
}
