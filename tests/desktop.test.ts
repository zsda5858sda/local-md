import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternalLink } from "../src/services/desktop";

describe("desktop external links", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens confirmed HTTP(S) links through the browser fallback", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    await openExternalLink("https://example.com/docs");
    expect(open).toHaveBeenCalledWith("https://example.com/docs", "_blank", "noopener,noreferrer");
  });

  it("rejects non-HTTP(S) external links", async () => {
    vi.stubGlobal("window", { open: vi.fn() });

    await expect(openExternalLink("notes/local.md")).rejects.toThrow(/HTTP\(S\)/);
  });
});
