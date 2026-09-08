import { afterEach, expect, it, vi } from "vitest";
import { routeParams } from "./navigation";

afterEach(() => vi.unstubAllGlobals());
it("uses the server-supplied id, not an unvalidated URL", () => {
  vi.stubGlobal("document", { getElementById: () => ({ dataset: { secretId: "server-id" } }) });
  vi.stubGlobal("location", { pathname: "/v/other", hash: "#private-key" });
  expect(routeParams()).toEqual({ id: "server-id" });
});
it("does not invent an id without the root element", () => {
  vi.stubGlobal("document", { getElementById: () => null });
  expect(routeParams()).toEqual({ id: undefined });
});
