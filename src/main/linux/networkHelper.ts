import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export class NetworkHelper extends EventEmitter<{ exit: [code: number | null]; lost: [] }> {
  private child: ChildProcessWithoutNullStreams | null = null;
  private serial = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  async request(command: string, data: Record<string, unknown> = {}): Promise<unknown> {
    if (process.platform !== "linux") throw new Error("VPN доступен только в Linux-сборке");
    if (!this.child) this.launch();
    const child = this.child;
    if (!child) throw new Error("Сетевой помощник недоступен");
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Do not allow a late authorized start to outlive a timed-out request.
        child.stdin.end();
        this.failAll(new Error("Истекло время ожидания сетевого помощника"));
      }, 120_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, command, ...data })}\n`, (error) => {
        if (error) this.failAll(new Error("Связь с сетевым помощником потеряна"));
      });
    });
  }
  private launch(): void {
    const helper = app.isPackaged ? join(process.resourcesPath, "linux", "levik-network.py") : join(app.getAppPath(), "native", "levik-network.py");
    const assets = app.isPackaged ? join(process.resourcesPath, "xray") : join(app.getAppPath(), "vendor", "xray", "linux-x64");
    // pkexec grants authority only to the helper; Electron never runs as root.
    const child = spawn("pkexec", ["/usr/bin/python3", "-I", helper, assets], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr.resume(); // Never forward privileged process output or profiles to UI logs.
    child.stdin.on("error", () => this.failAll(new Error("Связь с сетевым помощником потеряна")));
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const reply: unknown = JSON.parse(line);
        if (!reply || typeof reply !== "object") return;
        const message = reply as Record<string, unknown>;
        if (message.event === "exit") { this.emit("exit", typeof message.code === "number" ? message.code : null); return; }
        if (typeof message.id !== "number") return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.ok === true) pending.resolve(message.result);
        else pending.reject(new Error(typeof message.error === "string" ? message.error : "Ошибка сетевого помощника"));
      } catch { this.failAll(new Error("Некорректный ответ сетевого помощника")); }
    });
    child.on("error", () => this.failAll(new Error("Установите pkexec и polkit agent для авторизации VPN")));
    child.on("exit", () => {
      if (this.child === child) this.child = null;
      this.failAll(new Error("Авторизация отменена или сетевой помощник завершён; Kill Switch сохраняет блокировку"));
      this.emit("lost");
    });
  }
  private failAll(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close(): void { this.child?.stdin.end(); }
}
export const networkHelper = new NetworkHelper();
export async function previousKillSwitch(): Promise<boolean> {
  try { return JSON.parse(await readFile("/run/levik-vpn/state.json", "utf8")).killSwitch === true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Не удалось проверить сохранённое состояние Kill Switch");
  }
}

export async function previousDnsProtection(): Promise<boolean> {
  try { return JSON.parse(await readFile("/run/levik-vpn/state.json", "utf8")).dnsProtection === true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("Не удалось проверить сохранённое состояние DNS-защиты");
  }
}
