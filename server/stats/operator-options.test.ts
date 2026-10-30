import assert from "node:assert/strict";
import { statsOperatorOptions } from "./operator-options";

const target = ["--actor", "admin", "--project", "demo-quizee-drafts"];
assert.equal(statsOperatorOptions(["integrity", ...target]).apply, false);
assert.equal(statsOperatorOptions(["integrity", ...target, "--all"]).all, true);
assert.throws(() => statsOperatorOptions(["import", ...target]), /Choose/);
assert.throws(() => statsOperatorOptions(["integrity"]), /actor/);
assert.throws(() => statsOperatorOptions(["rebuild", ...target, "--game", "quiz", "--apply"]), /dry-run/);
assert.throws(() => statsOperatorOptions(["integrity", ...target, "--apply"]), /never repair/);
assert.throws(() => statsOperatorOptions(["cleanup-snapshots", ...target]), /cutoff/);
assert.throws(() => statsOperatorOptions(["integrity", ...target, "--cutoff", "2020"]), /Unsupported/);
assert.throws(() => statsOperatorOptions(["integrity", ...target, "--limit", "0"]), /limit/);
assert.throws(() => statsOperatorOptions(["person", ...target, "--person", "one", "--expected-version", "NaN"]), /integer/);
assert.equal(statsOperatorOptions(["person", ...target, "--person", "one", "--apply", "--expected-version", "3"]).expectedVersion, 3);
