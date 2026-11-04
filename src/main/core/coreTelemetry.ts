import { networkTypeOfInterface } from "../telemetry/codes";
import { isNetworkType } from "./coreGuards";
import type { RustCore } from "./rustCore";

const NETWORK = "telemetryCodes.networkTypeOfInterface";

/** The network type of the outbound interface, through the Rust core. */
export function networkTypeOfInterfaceWithCore(core: RustCore, name: string | null): ReturnType<typeof networkTypeOfInterface> {
  if (core.mode === "ts" || !core.has(NETWORK)) return networkTypeOfInterface(name);
  return core.run(NETWORK, { name, platform: "linux" }, () => networkTypeOfInterface(name), isNetworkType);
}
