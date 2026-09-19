import { describe, expect, it } from "vitest";
import { parseProcRoute, selectLinuxOutboundInterface } from "../src/main/linux/outboundInterface";
describe("Linux default route selection", () => {
  it("selects the lowest-metric real uplink and excludes tunnels/down links", () => {
    expect(selectLinuxOutboundInterface([
      { dst: "default", dev: "LevikVPN", metric: 0 },
      { dst: "default", dev: "eth0", metric: 10, flags: ["linkdown"] },
      { dst: "default", dev: "wlan0", metric: 200 },
      { dst: "default", dev: "enp0s3", metric: 100 },
    ])).toBe("enp0s3");
  });
  it("parses procfs and rejects missing or hostile interfaces", () => {
    expect(parseProcRoute("Iface Destination Gateway Flags RefCnt Use Metric\nwlan0 00000000 0100000A 0003 0 0 600\neth0 00000000 0100000A 0003 0 0 100\n")).toBe("eth0");
    for (const value of [null, [], [{ dst: "default", dev: "eth0;reboot" }], [{ dst: "default", dev: "lo" }]]) {
      expect(() => selectLinuxOutboundInterface(value)).toThrow();
    }
  });
});
