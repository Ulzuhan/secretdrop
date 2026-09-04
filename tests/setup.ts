import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const store = mkdtempSync(join(tmpdir(), "secretdrop-unit-"));
process.env.SECRETDROP_STORE_DIR = store;
afterAll(() => rmSync(store, { recursive: true, force: true }));
