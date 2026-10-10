// Codes from docs/connection-telemetry.md. Raw errors and log lines never
// leave the device; only these fixed identifiers do.

export type ProtocolName =
  | "vless-reality" | "vless-xhttp" | "vless-ws" | "vless-grpc" | "vless-tcp"
  | "hysteria2" | "tuic" | "trojan" | "shadowsocks" | "relay" | "yandex" | "other";

/** Health probe failure code for an error raised by a socket or TLS layer. */
export function probeErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  switch (code) {
    case "ECONNREFUSED":
      return "refused";
    case "ECONNRESET":
    case "EPIPE":
    case "ECONNABORTED":
      return "reset";
    case "ETIMEDOUT":
      return "timeout";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
  }
  if (/^ERR_(TLS|SSL)|CERT|^UNABLE_TO_VERIFY|SELF_SIGNED/.test(code)) return "tls";
  return "other";
}

/**
 * Linux interface names: predictable names (wlp2s0, enp3s0, wwan0) and the
 * classic ones. Phones shared over USB appear as usb0 or rndis0.
 */
export function networkTypeOfInterface(name: string | null): "wifi" | "cellular" | "ethernet" | "unknown" {
  if (!name) return "unknown";
  if (/^(wl|wifi|ath|ra\d)/i.test(name)) return "wifi";
  if (/^(ww|usb|rndis|rmnet|ppp)/i.test(name)) return "cellular";
  if (/^(en|eth)/i.test(name)) return "ethernet";
  return "unknown";
}

type ServerLike = { tuic?: unknown; outbound: Record<string, unknown> };

export function protocolOf(server: ServerLike): ProtocolName {
  if (server.tuic) return "tuic";
  const protocol = typeof server.outbound.protocol === "string" ? server.outbound.protocol.toLowerCase() : "";
  const stream = isRecord(server.outbound.streamSettings) ? server.outbound.streamSettings : {};
  const network = typeof stream.network === "string" ? stream.network.toLowerCase() : "tcp";
  const security = typeof stream.security === "string" ? stream.security.toLowerCase() : "none";
  switch (protocol) {
    case "vless":
      if (network === "xhttp" || network === "splithttp") return "vless-xhttp";
      if (network === "ws") return "vless-ws";
      if (network === "grpc") return "vless-grpc";
      return security === "reality" ? "vless-reality" : "vless-tcp";
    case "hysteria":
    case "hysteria2":
      return "hysteria2";
    case "tuic":
      return "tuic";
    case "trojan":
      return "trojan";
    case "shadowsocks":
      return "shadowsocks";
    default:
      return "other";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
