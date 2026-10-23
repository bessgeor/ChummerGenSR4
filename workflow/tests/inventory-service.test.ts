import { throws } from "node:assert/strict";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { requireValid } from "../src/inventory/inventory-service.js";
import { SourceInventorySchema } from "../src/inventory/source-inventory-document.js";
import { inventory } from "./inventory-fixtures.js";

test("a document that breaks its schema is a setup error naming the file and the field", () => {
  requireValid("source-inventory.json", SourceInventorySchema, inventory);
  throws(() => requireValid("source-inventory.json", SourceInventorySchema, { ...inventory, sourceSha256: "short" }),
    (error: unknown) => error instanceof SetupError && /^source-inventory\.json would not match its schema: sourceSha256 /.test(error.message));
});
