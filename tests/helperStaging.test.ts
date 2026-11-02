import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => "" } }));
import { stageHelper } from "../src/main/linux/helperStaging";
import { helperExitMessage } from "../src/main/linux/networkHelper";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function resources(missing?: string): Promise<{ resources: string; parent: string }> {
  const root = await mkdtemp(join(tmpdir(), "levik-staging-test-"));
  roots.push(root);
  const resources = join(root, "resources");
  await mkdir(join(resources, "linux"), { recursive: true });
  await mkdir(join(resources, "xray"), { recursive: true });
  const files: Array<[string, string]> = [["linux", "levik-network.py"], ["linux", "xray-integrity.json"], ["xray", "xray"], ["xray", "geoip.dat"], ["xray", "geosite.dat"]];
  for (const [dir, name] of files) {
    if (name !== missing) await writeFile(join(resources, dir, name), `${dir}/${name}`);
  }
  const parent = join(root, "tmp");
  await mkdir(parent);
  return { resources, parent };
}

describe("AppImage helper staging", () => {
  it("copies the helper and core out of the mount into a private directory", async () => {
    const { resources: source, parent } = await resources();
    const staged = await stageHelper(source, parent);
    expect(await readFile(staged.helper, "utf8")).toBe("linux/levik-network.py");
    expect(await readFile(join(staged.helper, "..", "xray-integrity.json"), "utf8")).toBe("linux/xray-integrity.json");
    expect((await readdir(staged.assets)).sort()).toEqual(["geoip.dat", "geosite.dat", "xray"]);
    const [directory] = await readdir(parent);
    expect((await stat(join(parent, directory ?? ""))).mode & 0o777).toBe(0o700);
    await staged.cleanup();
    expect(await readdir(parent)).toEqual([]);
  });

  it("leaves nothing behind when a resource is missing", async () => {
    const { resources: source, parent } = await resources("geosite.dat");
    await expect(stageHelper(source, parent)).rejects.toThrow();
    expect(await readdir(parent)).toEqual([]);
  });
});

describe("helper exit messages", () => {
  it("separates a dismissed dialog, failed authorization and startup errors", () => {
    expect(helperExitMessage(126, null)).toBe("Авторизация отменена");
    expect(helperExitMessage(127, null)).toContain("Авторизация не получена");
    expect(helperExitMessage(1, "nft not found")).toBe("Сетевой помощник не запустился: nft not found");
    expect(helperExitMessage(null, null)).toContain("Kill Switch");
  });
});
