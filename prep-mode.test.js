"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const CourseGate = require("./gate-client.js");

const html = fs.readFileSync("index.html", "utf8");

const TOKEN = "tx7d29all38";

test("isPrepMode 只认完全相等的口令", () => {
  assert.equal(CourseGate.isPrepMode("?prep=tx7d29all38", TOKEN), true);
  assert.equal(CourseGate.isPrepMode("?foo=1&prep=tx7d29all38", TOKEN), true);
  assert.equal(CourseGate.isPrepMode("?prep=wrong", TOKEN), false);
  assert.equal(CourseGate.isPrepMode("?prep=tx7d29all38x", TOKEN), false);
  assert.equal(CourseGate.isPrepMode("?prep=", TOKEN), false);
  assert.equal(CourseGate.isPrepMode("", TOKEN), false);
  assert.equal(CourseGate.isPrepMode(null, TOKEN), false);
});

test("index.html 定义备课口令并接入 isPrepMode", () => {
  assert.match(html, /const PREP_MODE_TOKEN = "tx7d29all38";/);
  assert.match(html, /const PREP_MODE = CourseGate\.isPrepMode\(location\.search, PREP_MODE_TOKEN\);/);
  const isUnlockedSource = html.match(/function isUnlocked\(id\)\{[\s\S]*?\n\}/);
  assert.ok(isUnlockedSource, "应存在 isUnlocked");
  assert.match(isUnlockedSource[0], /if\(PREP_MODE\) return i >= 0;/);
});

function makeIsUnlocked({ prepMode, unlockMode, gateState, doneIds, flatIds }) {
  const source = html.match(/function isUnlocked\(id\)\{[\s\S]*?\n\}/)[0];
  const factory = new Function(
    "PREP_MODE", "CONFIG", "CourseGate", "gateState", "FLAT_IDS", "getDone",
    `${source}; return isUnlocked;`
  );
  return factory(
    prepMode,
    { unlockMode },
    CourseGate,
    gateState,
    flatIds,
    () => new Set(doneIds || [])
  );
}

const FLAT_IDS = Array.from({ length: 38 }, (_, i) => `lesson-${i + 1}`);
const lockedGate = CourseGate.sanitizeState({ openUpTo: 1 }, FLAT_IDS.length, 1);

test("普通入口 openUpTo=1 时只开放第一关", () => {
  const isUnlocked = makeIsUnlocked({
    prepMode: false, unlockMode: "manual", gateState: lockedGate, flatIds: FLAT_IDS
  });
  assert.equal(isUnlocked("lesson-1"), true);
  assert.equal(isUnlocked("lesson-2"), false);
  assert.equal(isUnlocked("lesson-38"), false);
});

test("备课入口在同样闸门状态下全部关卡可进", () => {
  const isUnlocked = makeIsUnlocked({
    prepMode: true, unlockMode: "manual", gateState: lockedGate, flatIds: FLAT_IDS
  });
  for (const id of FLAT_IDS) assert.equal(isUnlocked(id), true, id + " 应可进入");
  assert.equal(isUnlocked("no-such-lesson"), false, "不存在的关卡不因备课模式放行");
});

test("备课入口在自学模式下同样全开，不依赖通关进度", () => {
  const isUnlocked = makeIsUnlocked({
    prepMode: true, unlockMode: "auto", gateState: lockedGate, doneIds: [], flatIds: FLAT_IDS
  });
  assert.equal(isUnlocked("lesson-38"), true);
});

test("远端闸门刷新回 openUpTo=1 也不会把备课模式锁回去", () => {
  const refreshed = CourseGate.sanitizeState(
    { openUpTo: 1, version: 9, source: "remote", online: true }, FLAT_IDS.length, 1
  );
  const isUnlocked = makeIsUnlocked({
    prepMode: true, unlockMode: "manual", gateState: refreshed, flatIds: FLAT_IDS
  });
  assert.equal(isUnlocked("lesson-38"), true);
});

test("错误或缺失的 prep 值维持学生端行为", () => {
  for (const search of ["?prep=guess", "?prep=TX7D29ALL38", "?other=1", ""]) {
    const prep = CourseGate.isPrepMode(search, TOKEN);
    const isUnlocked = makeIsUnlocked({
      prepMode: prep, unlockMode: "manual", gateState: lockedGate, flatIds: FLAT_IDS
    });
    assert.equal(isUnlocked("lesson-2"), false, search + " 不得绕过闸门");
  }
});
