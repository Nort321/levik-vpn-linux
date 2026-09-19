import { readdir, readlink, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type { LinuxProcess } from "../../shared/contracts";
import { mergeProcessList, normalizeExecutableName } from "../../shared/processes";
export function linuxProcessFromPath(path: string): LinuxProcess | null {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path)) return null;
  const name = normalizeExecutableName(basename(path));
  return name ? { name, path, running: null } : null;
}
export async function listLinuxProcesses(): Promise<LinuxProcess[]> {
  if (process.platform !== "linux") return [];
  const processes: LinuxProcess[] = [];
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      // Do not enumerate other users' application paths.
      if ((await stat(`/proc/${pid}`)).uid !== process.getuid?.()) continue;
      const entry = linuxProcessFromPath((await readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, ""));
      if (entry) processes.push({ ...entry, running: true });
    } catch { /* Process exited or procfs access is restricted. */ }
  }
  return mergeProcessList(processes, []).sort((a, b) => a.name.localeCompare(b.name));
}
