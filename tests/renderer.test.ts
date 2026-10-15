// @vitest-environment jsdom
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AppSnapshot, LevikDesktopApi } from "../src/shared/contracts";
const snapshot: AppSnapshot = {
  appVersion: "1.0.0", tab: "home", status: "disconnected", statusDetail: null,
  sessionAvailable: true, selectedServerId: "de", selectedSubscriptionId: "sub", serverLatencies: {}, serverMaintenance: {},
  account: { userLabel: "Test", subscriptions: [{ uuid: "sub", title: "Test", status: "active", expireAt: null,
    traffic: { usedBytes: 0, limitBytes: 1000 }, devices: { used: 1, limit: 2, items: [{ id: "device", label: "Desktop" }] },
    shield: { supported: false, enabled: false }, actions: { renew: true, revokeDevice: true } }] },
  servers: [{ id: "de", tag: "de", name: "Berlin", countryCode: "DE", outbound: { protocol: "vless" } }, { id: "nl", tag: "nl", name: "Amsterdam", countryCode: "NL", outbound: { protocol: "vless" } }],
  settings: { routingMode: "global", automaticServer: true, autoReconnect: true, killSwitch: true, useDoh: true, dnsServer: "1.1.1.1", theme: "dark", launchAtLogin: false, autoConnectOnLaunch: false, closeToTray: true, preventDnsLeaks: true, favoriteServerIds: [], favoriteNodes: null, antiDpiEnabled: false, antiDpiPackets: "tlshello", antiDpiLength: "100-200", antiDpiInterval: "10-20", splitTunnelMode: "bypass", splitTunnelProcesses: [], connectionTelemetry: true, telemetryNoticeShown: true, syncSettings: true, sharePresence: true },
  sessionStartedAt: null, downloadBytes: 0, uploadBytes: 0, logs: [], busy: false,
  update: { status: "idle", version: null, progress: null, message: null },
  announcements: [], settingsSyncedAt: null, pendingApprovals: [], loginPending: false,
  remote: { devices: [], commands: [], notes: {}, loadedAt: null },
};
let emit: (value: AppSnapshot) => void = () => {};
const noop = vi.fn(async () => {});
const bridge: LevikDesktopApi = {
  snapshot: async () => structuredClone(snapshot), onSnapshot: (listener) => { emit = listener; return () => {}; },
  login: async () => ({ verificationUri: "https://leviknet.com", verificationCode: null, expiresAt: "", matchNumber: 37, telegramUri: null, approvalRequested: true }),
  answerApproval: vi.fn(async () => "approved" as const),
  cancelLogin: noop, logout: noop, refreshAccount: noop, selectSubscription: noop, selectServer: vi.fn(async () => {}),
  connect: noop, disconnect: noop, updateSettings: vi.fn(async () => {}), openExternal: noop,
  listProcesses: async () => [{ name: "firefox", path: "/usr/bin/firefox", running: true }, { name: "code", path: "/usr/bin/code", running: true }],
  selectExecutable: async () => null, pingServers: noop, revokeDevice: noop, setSubscriptionShield: noop,
  authorizeActivation: noop, checkForUpdates: noop, downloadUpdate: noop, installUpdate: noop, createSupportReport: async () => "https://note.leviknet.com/x#v1.key",
  dismissAnnouncement: vi.fn(async () => {}), openCabinet: vi.fn(async () => {}), onNavigate: () => () => {},
  refreshRemote: noop, sendRemoteCommand: vi.fn(async () => {}), openRemoteNote: vi.fn(async () => {}),
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
  it("shows announcements and opens the personal cabinet signed in", () => {
    emit({ ...snapshot, announcements: [{ id: "0b8f5f0e-7d1c-4d6f-9b6a-1d8f0e2a3b4c", level: "critical", title: "Сбой", body: "Чиним", linkUrl: null, notify: false, startsAt: 0, endsAt: 1 }] });
    expect(document.querySelector(".announcement.critical")?.getAttribute("role")).toBe("alert");
    button('[data-dismiss-announcement]').click();
    expect(bridge.dismissAnnouncement).toHaveBeenCalledWith("0b8f5f0e-7d1c-4d6f-9b6a-1d8f0e2a3b4c");
    button("#cabinet-button").click();
    expect(bridge.openCabinet).toHaveBeenCalledWith("/dashboard");
  });
  it("asks for the number of a new sign-in, answers once and hides it on Escape", async () => {
    const approval = { id: "5e0c7a52-8b1d-4f3a-9c2e-7d6b5a4f3e21", deviceName: "<b>DESKTOP-7F</b>", platformLabel: "Windows", choices: [37, 52, 81], expiresAt: new Date(Date.now() + 300_000).toISOString() };
    emit({ ...snapshot, pendingApprovals: [approval] });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("<b>DESKTOP-7F</b>");
    expect(dialog?.querySelector("b")).toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
    for (let i = 1; i <= 3; i++) emit({ ...snapshot, downloadBytes: i, pendingApprovals: [approval] });
    button('[data-approval-number="52"]').click();
    expect(bridge.answerApproval).toHaveBeenCalledTimes(1);
    expect(bridge.answerApproval).toHaveBeenCalledWith(approval.id, 52);
    await Promise.resolve(); await Promise.resolve();
    const second = { ...approval, id: "6f1d8b63-9c2e-4a4b-8d3f-8e7c6b5a4f32" };
    emit({ ...snapshot, pendingApprovals: [second] });
    press("Escape");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    emit({ ...snapshot, pendingApprovals: [second] });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(bridge.answerApproval).toHaveBeenCalledTimes(1);
  });
  it("shows the sign-in number and offers to start again once the attempt is over", async () => {
    const signedOut = { ...snapshot, sessionAvailable: false, account: null };
    emit(signedOut);
    button("#login-button").click();
    emit({ ...signedOut, busy: true });
    await Promise.resolve(); await Promise.resolve();
    emit({ ...signedOut, loginPending: true });
    expect(document.querySelector(".login-match-number")?.textContent).toBe("37");
    expect(button("#login-button").getAttribute("aria-disabled")).toBe("true");
    emit({ ...signedOut, loginPending: false, statusDetail: "Вход отменён: выбрано другое число или нажато «Это не я»" });
    expect(button("#login-button").getAttribute("aria-disabled")).toBeNull();
    expect(document.querySelector(".login-status")?.textContent).toContain("Вход отменён");
    expect(document.querySelector(".login-match")).toBeNull();
  });
  it("marks a server going into maintenance in the list", () => {
    const end = new Date(2026, 9, 14, 14, 30).getTime();
    emit({ ...snapshot, serverMaintenance: { de: end } });
    button('[data-tab="servers"]').click();
    expect(document.querySelector('[data-server-id="de"] .server-maintenance')?.textContent).toBe("Обслуживание до 14:30");
    expect(button('[data-server-id="de"]').getAttribute("aria-label")).toContain("обслуживание до 14:30");
    expect(document.querySelector('[data-server-id="nl"] .server-maintenance')).toBeNull();
  });
  it("sends remote commands to another app once, waits for the answer and opens its diagnostics", () => {
    const phone = { deviceId: "phone", name: "<i>Pixel</i>", platform: "android" as const, appVersion: "2.7.30", current: false, remote: true, online: true, vpnConnected: true, country: "DE" };
    const self = { ...phone, deviceId: "self", name: "Laptop", platform: "linux" as const, current: true };
    const remote = { devices: [self, phone], commands: [], notes: {}, loadedAt: Date.now() };
    emit({ ...snapshot, remote });
    button('[data-tab="profile"]').click();
    expect(document.querySelector('[data-remote-device-id="self"]')).toBeNull();
    expect(document.querySelector(".remote-devices")?.innerHTML).toContain("&lt;i&gt;Pixel&lt;/i&gt;");
    const trigger = button('[data-remote-device-id="phone"]'); trigger.focus(); trigger.click();
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('[data-remote-command="disconnect"]')).toBeNull();
    emit({ ...snapshot, remote, downloadBytes: 5 });
    button('[data-remote-command="connect"]').click();
    expect(bridge.sendRemoteCommand).toHaveBeenCalledTimes(1);
    expect(bridge.sendRemoteCommand).toHaveBeenCalledWith("phone", "connect");
    const id = "0b8f5f0e-7d1c-4d6f-9b6a-1d8f0e2a3b4d";
    emit({ ...snapshot, remote: { ...remote, commands: [{ id, deviceId: "phone", command: "collect_diagnostics", state: "delivered", detail: null }] } });
    expect(button('[data-remote-command="connect"]').getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector("#remote-dialog-status")?.textContent).toContain("выполняет");
    emit({ ...snapshot, remote: { ...remote, commands: [{ id, deviceId: "phone", command: "collect_diagnostics", state: "done", detail: "sealed" }], notes: { [id]: "https://note.leviknet.org/a#b" } } });
    button(`[data-remote-note="${id}"]`).click();
    expect(bridge.openRemoteNote).toHaveBeenCalledWith(id);
    press("Escape"); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
});
