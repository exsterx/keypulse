import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanArgs, parseDurationSeconds } from "../src/utils/misc";

test("scan arguments keep the duration and pick up the deep flag", () => {
  assert.deepEqual(parseScanArgs(""), { duration: "", deep: false, fast: false });
  assert.deepEqual(parseScanArgs("7d"), { duration: "7d", deep: false, fast: false });
  assert.deepEqual(parseScanArgs("7d deep"), { duration: "7d", deep: true, fast: false });
  assert.deepEqual(parseScanArgs("deep 7d"), { duration: "7d", deep: true, fast: false });
  assert.deepEqual(parseScanArgs("  30d   --deep  "), { duration: "30d", deep: true, fast: false });
  assert.deepEqual(parseScanArgs("семантика 24h"), { duration: "24h", deep: true, fast: false });
  assert.deepEqual(
    parseScanArgs("deep"),
    { duration: "", deep: true, fast: false },
    "the window falls back to BACKFILL_DAYS"
  );
});

test("scan arguments pick up the fast (keywords-only) flag", () => {
  assert.deepEqual(parseScanArgs("7d fast"), { duration: "7d", deep: false, fast: true });
  assert.deepEqual(parseScanArgs("--fast 24h"), { duration: "24h", deep: false, fast: true });
  assert.deepEqual(parseScanArgs("30d keywords"), { duration: "30d", deep: false, fast: true });
  assert.deepEqual(parseScanArgs("7d быстро"), { duration: "7d", deep: false, fast: true });
  assert.deepEqual(
    parseScanArgs("7d deep fast"),
    { duration: "7d", deep: true, fast: false },
    "an explicit semantic request wins over the keywords-only flag"
  );
});

test("a deep scan without a duration still uses the configured window", () => {
  const { duration, deep } = parseScanArgs("deep");
  assert.equal(deep, true);
  assert.equal(parseDurationSeconds(duration || undefined, 7), 7 * 86400);
});
