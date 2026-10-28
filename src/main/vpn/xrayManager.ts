import { ServiceRouteSession } from "./serviceRouteSession";
import type { ServiceRouteStatus } from "./serviceRoutes";
import { app } from "electron";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { parseXrayStats } from "./xrayStats";
import { bindXrayOutboundInterface } from "./xrayConfig";
import { findLinuxOutboundInterface } from "../linux/outboundInterface";
import { networkHelper } from "../linux/networkHelper";

export class XrayManager extends EventEmitter<{ log: [line: string]; exit: [code: number | null, expected: boolean]; stats: [downloadBytes: number, uploadBytes: number]; serviceRoutes: [status: ServiceRouteStatus] }> {
  readonly serviceRoutes = new ServiceRouteSession((status) => this.emit("serviceRoutes", status));
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private outboundName: string | null = null;
  constructor() {
    super();
    networkHelper.on("exit", (code) => this.exited(code));
    networkHelper.on("lost", () => this.exited(null));
  }
  async start(config: Record<string, unknown>): Promise<void> {
    await this.stop();
    const interfaceName = await findLinuxOutboundInterface();
    this.outboundName = interfaceName;
    await networkHelper.request("start", { config: bindXrayOutboundInterface(config, interfaceName) });
    this.running = true;
    try { await this.serviceRoutes.start(config); }
    catch (error) { await this.stop(); throw error; }
    this.timer = setInterval(() => void this.queryStats(), 2000);
    this.emit("log", "Linux TUN подключён; сетевые настройки применены");
  }
  /** The bundled core run as this user, for the home exit (the tunnel's core runs in the helper). */
  executablePath(): string {
    return app.isPackaged ? join(process.resourcesPath, "xray", "xray") : join(app.getAppPath(), "vendor", "xray", "linux-x64", "xray");
  }
  async stop(): Promise<void> {
    this.serviceRoutes.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running) return;
    await networkHelper.request("stop");
    this.running = false;
  }
  isRunning(): boolean { return this.running; }
  /** The physical interface the last tunnel was bound to. */
  get outboundInterfaceName(): string | null { return this.outboundName; }
  async isHealthy(): Promise<boolean> {
    if (!this.running) return false;
    try {
      if (this.serviceRoutes.authentication) {
        if (this.serviceRoutes.active) await this.serviceRoutes.queryStats();
        const healthy = this.serviceRoutes.active || await this.serviceRoutes.probeCurrent();
        return this.running && healthy;
      }
      await networkHelper.request("stats"); return this.running;
    }
    catch { return false; }
  }
  private exited(code: number | null): void {
    if (!this.running) return;
    this.serviceRoutes.stop();
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit("exit", code, false);
  }
  private async queryStats(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;
    try {
      if (this.serviceRoutes.authentication) {
        const stats = await this.serviceRoutes.queryStats();
        if (this.running) this.emit("stats", stats.downlink, stats.uplink);
        return;
      }
      const result = await networkHelper.request("stats");
      if (typeof result !== "string") throw new Error("Invalid core statistics");
      const stats = parseXrayStats(result);
      if (this.running) this.emit("stats", stats.downlink, stats.uplink);
    } catch { /* Health monitor handles core failures without noisy repeated logs. */ }
    finally { this.polling = false; }
  }
}
