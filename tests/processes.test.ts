import { describe, expect, it } from "vitest";
import { linuxProcessFromPath } from "../src/main/linux/processes";
import { mergeProcessList, normalizeExecutableName, normalizeProcessSelection, resolveProcessCompanions } from "../src/shared/processes";
describe("Linux executable names", () => {
  it("accepts extensionless names and preserves Linux case sensitivity", () => {
    expect(linuxProcessFromPath("/usr/bin/firefox")).toEqual({ name: "firefox", path: "/usr/bin/firefox", running: null });
    expect(normalizeProcessSelection(["App", "app", "App"])).toEqual(["App", "app"]);
    expect(resolveProcessCompanions(["steam"])).toEqual(["steam"]);
  });
  it("rejects paths and control characters in process rules", () => {
    for (const value of ["", "../bad", "a\nb", ".", "..", null]) expect(normalizeExecutableName(value)).toBeNull();
    expect(linuxProcessFromPath("relative/path")).toBeNull();
  });
  it("retains selected stopped processes when procfs no longer includes them", () => {
    expect(mergeProcessList([{ name: "App", path: "/opt/App", running: true }], ["app"])).toHaveLength(2);
  });
});
