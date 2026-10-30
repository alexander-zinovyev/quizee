import assert from "node:assert/strict";
import { assertStatsPublicEnabled, statsPublicEnabled } from "./public-access";

const previous = process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED;
try {
  delete process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED;
  assert.equal(statsPublicEnabled(), false);
  assert.throws(assertStatsPublicEnabled, /unavailable/);
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "true";
  assert.equal(statsPublicEnabled(), true); assert.doesNotThrow(assertStatsPublicEnabled);
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "false";
  assert.throws(assertStatsPublicEnabled, /unavailable/);
  process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = "1";
  assert.throws(statsPublicEnabled, /must be true or false/);
} finally {
  if (previous === undefined) delete process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED; else process.env.QUIZEE_STATISTICS_PUBLIC_ENABLED = previous;
}
