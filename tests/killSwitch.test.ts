import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/main/linux/networkHelper", () => ({ networkHelper: { request: vi.fn() }, previousKillSwitch: vi.fn(), previousDnsProtection: vi.fn(async () => false) }));
import { networkHelper, previousKillSwitch } from "../src/main/linux/networkHelper";
import { LinuxKillSwitch } from "../src/main/linux/killSwitch";
import { DnsLeakProtection } from "../src/main/linux/dnsLeakProtection";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(previousKillSwitch).mockResolvedValue(false); });
describe("Linux protection lifecycle", () => {
  it("recovers a retained kill switch and repairs a missing firewall", async () => {
    vi.mocked(previousKillSwitch).mockResolvedValue(true);
    const guard = new LinuxKillSwitch();
    expect(await guard.recover()).toBe(true);
    vi.mocked(networkHelper.request).mockResolvedValue(false);
    expect(await guard.ensureActive(() => true)).toBe(true);
    expect(networkHelper.request).toHaveBeenLastCalledWith("kill-enable");
  });
  it("does not claim protection if privilege authorization fails", async () => {
    vi.mocked(networkHelper.request).mockRejectedValue(new Error("denied"));
    const guard = new LinuxKillSwitch();
    await expect(guard.enable()).rejects.toThrow("denied");
    expect(guard.isActive()).toBe(false);
  });
  it("keeps active state when removing the firewall fails", async () => {
    const guard = new LinuxKillSwitch();
    await guard.enable();
    vi.mocked(networkHelper.request).mockRejectedValueOnce(new Error("nft failed"));
    await expect(guard.disable()).rejects.toThrow();
    expect(guard.isActive()).toBe(true);
  });
  it("cancels recovery after the user disconnects", async () => {
    const guard = new LinuxKillSwitch(); await guard.enable();
    expect(await guard.ensureActive(() => false)).toBe(false);
  });
  it("serializes DNS protection through the helper and permits retry after failure", async () => {
    const dns = new DnsLeakProtection(); await dns.enable();
    vi.mocked(networkHelper.request).mockRejectedValueOnce(new Error("resolver failed"));
    await expect(dns.disable()).rejects.toThrow();
    await dns.disable();
    expect(networkHelper.request).toHaveBeenLastCalledWith("dns-disable");
  });
});
