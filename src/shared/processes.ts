import type { LinuxProcess } from "./contracts";

export function normalizeExecutableName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name !== "." && name !== ".." && /^[^/\\\u0000-\u001f]{1,255}$/.test(name) ? name : null;
}

export function normalizeProcessSelection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = new Map<string, string>();
  for (const item of value) {
    const name = normalizeExecutableName(item);
    if (name && !names.has(name)) names.set(name, name);
  }
  return [...names.values()].slice(0, 200);
}

export function resolveProcessCompanions(selected: readonly string[]): string[] {
  return normalizeProcessSelection(selected);
}

export function mergeProcessList(processes: readonly LinuxProcess[], selected: readonly string[]): LinuxProcess[] {
  const entries = new Map<string, LinuxProcess>();
  for (const item of processes) {
    const key = item.name;
    const previous = entries.get(key);
    entries.set(key, {
      name: item.running === true ? item.name : previous?.name ?? item.name,
      path: item.path ?? previous?.path ?? null,
      running: item.running === true || previous?.running === true ? true : item.running ?? previous?.running ?? null,
    });
  }
  for (const name of resolveProcessCompanions(selected)) {
    if (!entries.has(name)) entries.set(name, { name, path: null, running: false });
  }
  return [...entries.values()];
}

export function sortProcessList(processes: readonly LinuxProcess[], selected: readonly string[]): LinuxProcess[] {
  const keys = new Set(resolveProcessCompanions(selected).map((name) => name));
  return [...processes].sort((left, right) => Number(keys.has(right.name)) - Number(keys.has(left.name))
    || left.name.localeCompare(right.name, "ru", { sensitivity: "base" }));
}

export function processStatusLabel(process: LinuxProcess): string {
  if (process.running === true) return process.path ?? "Запущено · путь недоступен";
  if (process.running === false) return "Процесс сейчас не запущен";
  return process.path ?? "Состояние процесса неизвестно";
}
