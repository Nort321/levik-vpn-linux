// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { KeyboardNavigation, patchHtml } from "../src/renderer/accessibility";
let root: HTMLElement;
beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; root = document.getElementById("app")!; });
describe("Live render focus preservation", () => {
  it("preserves the actual focused button node when a snapshot changes", () => {
    patchHtml(root, '<button data-setting="killSwitch">Off</button>');
    const button = root.querySelector("button")!; button.focus();
    let blurs = 0; button.addEventListener("blur", () => blurs++);
    patchHtml(root, '<button data-setting="killSwitch">On</button>');
    expect(document.activeElement).toBe(button); expect(blurs).toBe(0); expect(button.textContent).toBe("On");
  });
  it("keeps a pending action focusable while announcing its disabled state", () => {
    patchHtml(root, '<button id="update">Update</button>');
    const control = root.querySelector("button")!; control.focus();
    patchHtml(root, '<button id="update" disabled>Downloading</button>');
    expect(document.activeElement).toBe(control); expect(control.disabled).toBe(false);
    expect(control.getAttribute("aria-disabled")).toBe("true");
  });
  it("preserves search text, selection and identity across a new server snapshot", () => {
    patchHtml(root, '<input id="search" value=""><p>old</p>');
    const search = root.querySelector("input")!; search.focus(); search.value = "Berlin"; search.setSelectionRange(2, 4);
    patchHtml(root, '<input id="search" value=""><p>new</p>');
    expect(document.activeElement).toBe(search); expect(search.value).toBe("Berlin"); expect(search.selectionStart).toBe(2);
  });
  it("keeps a server's key when the list order changes", () => {
    patchHtml(root, '<div class="server-list"><button data-server-id="a">A</button><button data-server-id="b">B</button></div>');
    const button = root.querySelector<HTMLButtonElement>('[data-server-id="b"]')!; button.focus();
    patchHtml(root, '<div class="server-list"><button data-server-id="b">B 20ms</button><button data-server-id="a">A</button></div>');
    expect(document.activeElement).toBe(button); expect(root.querySelector("button")).toBe(button);
  });
});
describe("Dialog and list keyboard navigation", () => {
  it("traps focus, closes on Escape and restores the triggering control", () => {
    const shell = '<div class="shell"><button id="open">Devices</button></div>';
    let close = false;
    const keyboard = new KeyboardNavigation(root, () => { close = true; keyboard.beforeRender(); patchHtml(root, shell); keyboard.afterRender(); });
    patchHtml(root, shell); const trigger = root.querySelector("button")!; trigger.focus();
    keyboard.beforeRender(); patchHtml(root, shell + '<section role="dialog"><button id="first">Close</button><button id="last">Save</button></section>'); keyboard.afterRender();
    expect(document.activeElement?.id).toBe("first"); expect(root.querySelector<HTMLElement>(".shell")!.inert).toBe(true);
    document.getElementById("first")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement?.id).toBe("last");
    document.getElementById("last")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id).toBe("first");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(close).toBe(true); expect(document.activeElement).toBe(trigger);
  });
  it("navigates visible list controls with arrows and ignores hidden rows", () => {
    new KeyboardNavigation(root, () => {});
    patchHtml(root, '<div class="process-list"><button id="a">A</button><button hidden id="b">B</button><button id="c">C</button></div>');
    document.getElementById("a")!.focus(); document.getElementById("a")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.id).toBe("c");
  });
});
