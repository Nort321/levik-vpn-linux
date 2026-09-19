import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/main/linux/networkHelper", async () => {
  const { EventEmitter } = await import("node:events");
  return { networkHelper: Object.assign(new EventEmitter(), { request: vi.fn() }) };
});
vi.mock("../src/main/linux/outboundInterface", () => ({ findLinuxOutboundInterface: vi.fn(async () => "eth0") }));
import { networkHelper } from "../src/main/linux/networkHelper";
import { XrayManager } from "../src/main/vpn/xrayManager";
beforeEach(() => { vi.clearAllMocks(); networkHelper.removeAllListeners(); });
describe("Linux core lifecycle", () => {
  it("binds outbound interface and stops through the helper", async () => {
    const core = new XrayManager();
    await core.start({ inbounds: [{ protocol: "tun", settings: {} }] });
    expect(networkHelper.request).toHaveBeenCalledWith("start", { config: { inbounds: [{ protocol: "tun", settings: { autoOutboundsInterface: "eth0" } }] } });
    expect(core.isRunning()).toBe(true);
    await core.stop();
    expect(core.isRunning()).toBe(false);
    expect(networkHelper.request).toHaveBeenLastCalledWith("stop");
  });
  it("reports helper loss as unexpected core exit", async () => {
    const core = new XrayManager(); const exit = vi.fn(); core.on("exit", exit);
    await core.start({}); networkHelper.emit("lost");
    expect(core.isRunning()).toBe(false); expect(exit).toHaveBeenCalledWith(null, false);
  });
  it("does not report running if authorization or core validation fails", async () => {
    vi.mocked(networkHelper.request).mockRejectedValueOnce(new Error("denied"));
    const core = new XrayManager(); await expect(core.start({})).rejects.toThrow("denied");
    expect(core.isRunning()).toBe(false);
  });
});
