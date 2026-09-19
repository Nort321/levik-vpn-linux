import { networkHelper, previousKillSwitch } from "./networkHelper";
export class LinuxKillSwitch {
  private active = false;
  constructor(_xrayExecutablePath?: () => string) {}
  async recover(): Promise<boolean> { this.active = await previousKillSwitch(); return this.active; }
  async ensureActive(shouldRestore: () => boolean): Promise<boolean> {
    if (!this.active || !shouldRestore()) return false;
    if (await networkHelper.request("kill-status") === true) return false;
    if (!shouldRestore()) return false;
    await networkHelper.request("kill-enable");
    return true;
  }
  async cleanupLegacyConfig(_path: string): Promise<void> {}
  async enable(): Promise<void> { await networkHelper.request("kill-enable"); this.active = true; }
  async allowTunnel(): Promise<void> { /* nftables matches the stable TUN interface name. */ }
  async disable(): Promise<void> {
    if (!this.active && !await previousKillSwitch()) return;
    await networkHelper.request("kill-disable"); this.active = false;
  }
  isActive(): boolean { return this.active; }
}
