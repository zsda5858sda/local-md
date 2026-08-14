import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEditorLinkClick } from "../src/editor/extensions";

class TestElement extends EventTarget {
  constructor(private readonly href: string | null = null, readonly parentElement: TestElement | null = null) {
    super();
  }

  closest(selector: string): TestElement | null {
    if (selector !== "a[href]") return null;
    return this.href === null ? this.parentElement?.closest(selector) ?? null : this;
  }

  getAttribute(name: string): string | null {
    return name === "href" ? this.href : null;
  }
}

function clickEvent(ctrlKey = false): Event & Pick<MouseEvent, "ctrlKey" | "metaKey"> {
  const event = new Event("click", { bubbles: true, cancelable: true }) as Event & Pick<MouseEvent, "ctrlKey" | "metaKey">;
  Object.defineProperties(event, { ctrlKey: { value: ctrlKey }, metaKey: { value: false } });
  return event;
}

describe("editor DOM link clicks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cancels native anchor navigation and requires a modifier before requesting an external open", () => {
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("Node", TestElement);
    const anchor = new TestElement("https://example.com/docs");
    const label = new TestElement(null, anchor);
    const requested: string[] = [];
    let handled = false;
    label.addEventListener("click", (event) => {
      handled = handleEditorLinkClick(event as MouseEvent, (href) => requested.push(href));
    });

    const plainClick = clickEvent();
    label.dispatchEvent(plainClick);
    expect(plainClick.defaultPrevented).toBe(true);
    expect(handled).toBe(false);
    expect(requested).toEqual([]);

    const modifierClick = clickEvent(true);
    label.dispatchEvent(modifierClick);
    expect(modifierClick.defaultPrevented).toBe(true);
    expect(handled).toBe(true);
    expect(requested).toEqual(["https://example.com/docs"]);
  });
});
