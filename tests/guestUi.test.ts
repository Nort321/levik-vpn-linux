// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderGuestScreen } from "../src/renderer/guest";
import type { LevikDesktopApi } from "../src/shared/contracts";

function setup() {
  const connectGuest = vi.fn(async () => {});
  const disconnectGuest = vi.fn(async () => {});
  const importGuestInvite = vi.fn(async () => {});
  const methods: Pick<LevikDesktopApi, "connectGuest" | "disconnectGuest" | "importGuestInvite" | "connect"> = { connectGuest, disconnectGuest, importGuestInvite, connect: vi.fn(async () => {}) };
  Object.defineProperty(window, "levik", { value: methods, configurable: true });
  const root = document.createElement("div"); document.body.replaceChildren(root);
  return { root, methods };
}

describe("guest setup and offline instructions", () => {
  it("offers paste and file import before login and clears the pasted access key", async () => {
    const { root, methods } = setup();
    renderGuestScreen(root, { guest: null, busy: false, statusDetail: null }, "linux", (operation) => operation(), vi.fn());
    expect(root.textContent).toContain("Аккаунт и отдельная подписка");
    expect(root.textContent).toContain("восстановите прежние настройки");
    const input = root.querySelector<HTMLTextAreaElement>("#guest-invite")!;
    input.value = "levik-share://v1/test-access";
    root.querySelector<HTMLButtonElement>("#guest-connect")!.click();
    expect(methods.connectGuest).toHaveBeenCalledWith("levik-share://v1/test-access");
    expect(input.value).toBe("");
    root.querySelector<HTMLButtonElement>("#guest-file")!.click();
    expect(methods.importGuestInvite).toHaveBeenCalledOnce();
  });
  it("escapes the host name and keeps protection failure wording honest", () => {
    const { root } = setup();
    renderGuestScreen(root, { guest: { name: '<img src=x onerror="alert(1)">', expiresAt: Date.now() + 10000, phase: "blocked" }, busy: false,
      statusDetail: "Защита от прямого выхода не подтверждена." }, "macos", (operation) => operation(), vi.fn());
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("Защита от прямого выхода не подтверждена");
    expect(root.textContent).not.toContain("Обычный интернет остаётся заблокирован");
    expect(root.querySelector("#guest-retry")).not.toBeNull();
    expect(root.textContent).toContain("Системные настройки → Сеть → Wi-Fi");
  });
});
