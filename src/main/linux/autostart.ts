import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export function desktopExec(path: string): string {
  if (!path.startsWith("/") || /[\r\n\0]/.test(path)) throw new Error("Invalid executable path");
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("`", "\\`").replaceAll("$", "\\$").replaceAll("%", "%%")}"`;
}
export async function setAutostart(enabled: boolean): Promise<void> {
  const config = process.env.XDG_CONFIG_HOME;
  const directory = join(config?.startsWith("/") ? config : join(homedir(), ".config"), "autostart");
  const path = join(directory, "levik-vpn.desktop");
  if (!enabled) { await rm(path, { force: true }); return; }
  await mkdir(directory, { recursive: true });
  await writeFile(path, `[Desktop Entry]\nType=Application\nName=Levik VPN\nExec=${desktopExec(process.env.APPIMAGE ?? process.execPath)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
}
