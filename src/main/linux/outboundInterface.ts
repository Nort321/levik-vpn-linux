import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
const execute = promisify(execFile);
export function selectLinuxOutboundInterface(value: unknown): string {
  if (!Array.isArray(value)) throw new Error("Invalid route table");
  const candidates = value.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const route = row as Record<string, unknown>;
    if (route.dst !== "default" || typeof route.dev !== "string" || !validInterface(route.dev)
      || (Array.isArray(route.flags) && route.flags.includes("linkdown"))) return [];
    const metric = route.metric ?? 0;
    return typeof metric === "number" && Number.isFinite(metric) && metric >= 0 ? [{ name: route.dev, metric }] : [];
  }).sort((a, b) => a.metric - b.metric);
  if (!candidates[0]) throw new Error("Нет активного сетевого интерфейса с маршрутом по умолчанию");
  return candidates[0].name;
}
export function parseProcRoute(text: string): string {
  return selectLinuxOutboundInterface(text.split("\n").slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields[1] !== "00000000" || !(Number.parseInt(fields[3] ?? "0", 16) & 1)) return [];
    return [{ dst: "default", dev: fields[0], metric: Number(fields[6]) }];
  }));
}
function validInterface(name: string): boolean {
  return /^[a-zA-Z0-9_.:-]{1,15}$/.test(name) && !/^(lo$|LevikVPN$|tun|tap|wg|docker|veth)/.test(name);
}
export async function findLinuxOutboundInterface(): Promise<string> {
  for (const family of ["-4", "-6"]) {
    try {
      const { stdout } = await execute("ip", ["-j", family, "route", "show", "default"], { timeout: 5000, maxBuffer: 256 * 1024 });
      return selectLinuxOutboundInterface(JSON.parse(stdout) as unknown);
    } catch { /* Try the next address family or procfs. */ }
  }
  return parseProcRoute(await readFile("/proc/net/route", "utf8"));
}
