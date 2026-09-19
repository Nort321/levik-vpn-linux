import { networkHelper, previousDnsProtection } from "./networkHelper";
export class DnsLeakProtection {
  private enabled = false;
  async enable(): Promise<void> { await networkHelper.request("dns-enable"); this.enabled = true; }
  async disable(): Promise<void> {
    if (!this.enabled && !await previousDnsProtection()) return;
    await networkHelper.request("dns-disable"); this.enabled = false;
  }
}
