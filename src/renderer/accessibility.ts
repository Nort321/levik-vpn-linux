const CONTROL = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
const KEYS = ["id", "data-tab", "data-server-id", "data-favorite-server-id", "data-setting", "data-process-name", "data-subscription-id", "data-devices-subscription-id", "data-revoke-device-id", "data-shield-subscription-id", "data-renew-subscription-id"];
function key(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  for (const attribute of KEYS) {
    const value = node.getAttribute(attribute);
    if (value) return `${node.tagName}:${attribute}:${value}`;
  }
  // Key the container as well as its control when lists reorder.
  if (node.matches(".server-card,.subscription-wrap,.device-row")) {
    const control = node.querySelector(CONTROL);
    if (control) return `container:${key(control)}`;
  }
  return null;
}
function compatible(left: Node, right: Node): boolean {
  return left.nodeType === right.nodeType && left.nodeName === right.nodeName && key(left) === key(right);
}
function reconcile(parent: Node, template: Node): void {
  let cursor = parent.firstChild;
  for (const desired of Array.from(template.childNodes)) {
    let current: Node | undefined = cursor && compatible(cursor, desired) ? cursor : undefined;
    const desiredKey = key(desired);
    if (!current && desiredKey) current = Array.from(parent.childNodes).find((child) => compatible(child, desired));
    if (!current) {
      current = desired.cloneNode(true);
      parent.insertBefore(current, cursor);
    } else if (current !== cursor) {
      // Chromium's state-preserving move keeps focus and open native controls.
      if (parent instanceof Element && "moveBefore" in parent && typeof parent.moveBefore === "function") {
        parent.moveBefore(current, cursor);
      } else parent.insertBefore(current, cursor);
    }
    if (current instanceof Element && desired instanceof Element) {
      for (const attr of Array.from(current.attributes)) if (!desired.hasAttribute(attr.name)) current.removeAttribute(attr.name);
      for (const attr of Array.from(desired.attributes)) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
      reconcile(current, desired);
      // Keep unfinished edits/caret in the focused control across snapshots.
      if (current !== document.activeElement) {
        if (current instanceof HTMLInputElement && desired instanceof HTMLInputElement) current.value = desired.value;
        if (current instanceof HTMLSelectElement && desired instanceof HTMLSelectElement) current.value = desired.value;
      }
    } else if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
    cursor = current.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
}
export function patchHtml(root: HTMLElement, html: string): void {
  const active = document.activeElement;
  const activeKey = active ? key(active) : null;
  const template = document.createElement("template");
  template.innerHTML = html;
  // Pending actions remain focusable: native disabled buttons drop focus when
  // a progress snapshot arrives. Event bindings enforce aria-disabled instead.
  template.content.querySelectorAll("button[disabled]").forEach((button) => {
    button.removeAttribute("disabled");
    button.setAttribute("aria-disabled", "true");
  });
  reconcile(root, template.content);
  if (active instanceof HTMLElement && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
  if (activeKey && active instanceof HTMLElement && !active.isConnected) {
    Array.from(root.querySelectorAll<HTMLElement>(CONTROL)).find((element) => key(element) === activeKey)?.focus({ preventScroll: true });
  }
}
export function focusable(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CONTROL)).filter((node) => !node.closest('[hidden], [inert]') && getComputedStyle(node).display !== "none");
}
export class KeyboardNavigation {
  private modal: HTMLElement | null = null;
  private trigger: HTMLElement | null = null;
  private triggerKey: string | null = null;
  constructor(private readonly root: HTMLElement, private readonly dismiss: () => void) {
    document.addEventListener("keydown", (event) => this.onKey(event));
    document.addEventListener("focusin", (event) => {
      if (this.root.isConnected && this.modal && event.target instanceof Node && !this.modal.contains(event.target)) this.focusModal();
    });
  }
  beforeRender(): void {
    if (!this.modal && document.activeElement instanceof HTMLElement) {
      this.trigger = document.activeElement;
      this.triggerKey = key(this.trigger);
    }
  }
  afterRender(): void {
    const previous = this.modal;
    // The last modal is on top: a sign-in approval can open over another dialog.
    this.modal = Array.from(this.root.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')).at(-1) ?? null;
    const shell = this.root.querySelector<HTMLElement>(".shell");
    if (shell) shell.inert = Boolean(this.modal);
    if (this.modal && !previous) this.focusModal();
    else if (this.modal && !this.modal.contains(document.activeElement)) this.focusModal();
    else if (!this.modal && previous) {
      const target = this.trigger?.isConnected ? this.trigger : focusable(this.root).find((node) => key(node) === this.triggerKey);
      (target ?? focusable(this.root)[0])?.focus({ preventScroll: true });
      this.trigger = null;
    }
  }
  private focusModal(): void {
    if (!this.modal) return;
    this.modal.tabIndex = -1;
    (focusable(this.modal)[0] ?? this.modal).focus({ preventScroll: true });
  }
  private onKey(event: KeyboardEvent): void {
    if (!this.root.isConnected) return;
    if (event.isComposing || event.altKey || event.metaKey) return;
    if (this.modal) {
      if (event.key === "Escape") { event.preventDefault(); this.dismiss(); return; }
      if (event.key === "Tab") {
        const items = focusable(this.modal);
        const first = items[0]; const last = items.at(-1);
        if (!first) { event.preventDefault(); this.focusModal(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === this.modal)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
    }
    const target = event.target;
    const editing = target instanceof Element && target.matches('input,textarea,select,[contenteditable="true"]');
    if (editing) return;
    if (!this.modal && event.ctrlKey && /^[1-4]$/.test(event.key)) {
      const button = this.root.querySelectorAll<HTMLButtonElement>("[data-tab]")[Number(event.key) - 1];
      event.preventDefault(); button?.focus(); button?.click(); return;
    }
    if (event.ctrlKey) return;
    if (event.key === "/") {
      event.preventDefault();
      if (this.modal) this.modal.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      else {
        this.root.querySelector<HTMLButtonElement>('[data-tab="servers"]')?.click();
        document.getElementById("server-search-input")?.focus();
      }
      return;
    }
    if (target instanceof HTMLElement && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const list = target.closest(".server-list,.process-list,.device-list,.nav");
      if (list) {
        const selector = list.matches(".server-list") ? (target.matches(".favorite-button") ? ".favorite-button" : ".server-select") : CONTROL;
        const items = focusable(list).filter((item) => item.matches(selector));
        const index = items.indexOf(target);
        if (index >= 0) {
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          event.preventDefault(); items[next]?.focus();
        }
      }
    }
    // Native buttons already support Enter/Space. The global power shortcut
    // applies only when focus is not on another interactive control.
    if (!this.modal && (event.key === " " || event.key === "Enter") && !(target instanceof Element && target.closest(CONTROL))) {
      const power = document.getElementById("power-button");
      if (power) { event.preventDefault(); power.click(); }
    }
  }
}
