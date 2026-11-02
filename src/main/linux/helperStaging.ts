import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HELPER_FILES = ["levik-network.py", "xray-integrity.json"] as const;
const CORE_FILES = ["xray", "geoip.dat", "geosite.dat"] as const;

export type StagedHelper = { helper: string; assets: string; cleanup: () => Promise<void> };

/**
 * An AppImage is a FUSE mount without allow_other, so root cannot read the
 * helper inside it. Copy the helper and core into a private 0700 directory.
 * Trust is unchanged: the mount was user-controlled too, and the helper still
 * verifies the core against its pinned hashes before installing it.
 */
export async function stageHelper(resources: string, parent = tmpdir()): Promise<StagedHelper> {
  const root = await mkdtemp(join(parent, "levik-vpn-helper-"));
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    await Promise.all([mkdir(join(root, "linux")), mkdir(join(root, "xray"))]);
    await Promise.all([
      ...HELPER_FILES.map((name) => copyFile(join(resources, "linux", name), join(root, "linux", name))),
      ...CORE_FILES.map((name) => copyFile(join(resources, "xray", name), join(root, "xray", name))),
    ]);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { helper: join(root, "linux", "levik-network.py"), assets: join(root, "xray"), cleanup };
}
