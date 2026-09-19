// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppSnapshot, LevikDesktopApi } from "../src/shared/contracts";
const snapshot: AppSnapshot = {
  appVersion: "1.0.0", tab: "home", status: "disconnected", statusDetail: null,
  sessionAvailable: true, selectedServerId: "de", selectedSubscriptionId: "sub", serverLatencies: {},
  account: { userLabel: "Test", subscriptions: [{ uuid: "sub", title: "Test", status: "active", expireAt: null,
    traffic: { usedBytes: 0, limitBytes: 1000 }, devices: { used: 1, limit: 2, items: [{ id: "device", label: "Desktop" }] },
    shield: { supported: false, enabled: false }, actions: { renew: true, revokeDevice: true } }] },
  servers: [{ id: "de", tag: "de", name: "Berlin", countryCode: "DE", outbound: { protocol: "vless" } }, { id: "nl", tag: "nl", name: "Amsterdam", countryCode: "NL", outbound: { protocol: "vless" } }],
  settings: { routingMode: "global", automaticServer: true, autoReconnect: true, killSwitch: true, useDoh: true, dnsServer: "1.1.1.1", theme: "dark", launchAtLogin: false, autoConnectOnLaunch: false, closeToTray: true, preventDnsLeaks: true, favoriteServerIds: [], antiDpiEnabled: false, antiDpiPackets: "tlshello", antiDpiLength: "100-200", antiDpiInterval: "10-20", splitTunnelMode: "bypass", splitTunnelProcesses: [] },
  sessionStartedAt: null, downloadBytes: 0, uploadBytes: 0, logs: [], busy: false,
  update: { status: "idle", version: null, progress: null, message: null },
};
let emit: (value: AppSnapshot) => void = () => {};
const noop = vi.fn(async () => {});
const bridge: LevikDesktopApi = {
  snapshot: async () => structuredClone(snapshot), onSnapshot: (listener) => { emit = listener; return () => {}; },
  login: async () => ({ verificationUri: "https://leviknet.com", verificationCode: null, expiresAt: "" }),
  cancelLogin: noop, logout: noop, refreshAccount: noop, selectSubscription: noop, selectServer: vi.fn(async () => {}),
  connect: noop, disconnect: noop, updateSettings: vi.fn(async () => {}), openExternal: noop,
  listProcesses: async () => [{ name: "firefox", path: "/usr/bin/firefox", running: true }, { name: "code", path: "/usr/bin/code", running: true }],
  selectExecutable: async () => null, pingServers: noop, revokeDevice: noop, setSubscriptionShield: noop,
  authorizeActivation: noop, checkForUpdates: noop, downloadUpdate: noop, installUpdate: noop,
};
function button(selector: string): HTMLButtonElement { const node = document.querySelector<HTMLButtonElement>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; }
function press(key: string, ctrlKey = false): void { document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true })); }
vi.useFakeTimers();
document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
window.levik = bridge;
afterAll(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe("Rendered desktop integration", () => {
  it("preserves server/favorite focus and binds each action only once after snapshots", async () => {
    await import("../src/renderer/app.js"); await Promise.resolve();
    button('[data-tab="servers"]').click();
    const favorite = button('[data-favorite-server-id="de"]'); favorite.focus();
    for (let i = 1; i <= 5; i++) emit({ ...snapshot, serverLatencies: { de: i } });
    expect(document.activeElement).toBe(favorite);
    favorite.click(); expect(bridge.updateSettings).toHaveBeenCalledTimes(1);
    expect(bridge.updateSettings).toHaveBeenCalledWith({ favoriteServerIds: ["de"] });
  });
  it("uses Ctrl tabs and slash search, and preserves search caret on snapshots", () => {
    press("4", true); expect(document.querySelector("#process-picker-button")).not.toBeNull();
    press("/"); const search = document.querySelector<HTMLInputElement>("#server-search-input")!;
    expect(document.activeElement).toBe(search);
    search.value = "Ber"; search.dispatchEvent(new Event("input", { bubbles: true })); search.setSelectionRange(1, 2);
    emit({ ...snapshot, serverLatencies: { de: 80 } });
    expect(document.activeElement).toBe(search); expect(search.value).toBe("Ber"); expect(search.selectionStart).toBe(1);
  });
  it("keeps process dialog focus through loading/snapshots and restores its trigger", async () => {
    button('[data-tab="profile"]').click(); const trigger = button("#process-picker-button"); trigger.focus(); trigger.click();
    await Promise.resolve(); await Promise.resolve();
    const process = button('[data-process-name="firefox"]'); process.focus();
    emit({ ...snapshot, downloadBytes: 123 }); expect(document.activeElement).toBe(process);
    process.click(); expect(document.activeElement).toBe(process);
    press("Escape"); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("restores the devices trigger after Escape and gives all visible controls names", () => {
    const trigger = button('[data-devices-subscription-id="sub"]'); trigger.focus(); trigger.click();
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    press("Escape"); expect(document.activeElement).toBe(trigger);
    for (const control of Array.from(document.querySelectorAll<HTMLElement>("button,input,select"))) {
      const label = control.getAttribute("aria-label") || control.textContent?.trim() || (control.id && document.querySelector(`label[for="${control.id}"]`)?.textContent);
      expect(Boolean(label), `${control.tagName}#${control.id}`).toBe(true);
    }
  });
});
