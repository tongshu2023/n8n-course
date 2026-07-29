"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const data = fs.readFileSync("course-data.js", "utf8");
const course = new Function(`${data}; return COURSE;`)();
const lessons = course.chapters.flatMap(chapter => chapter.lessons);
const ANSWERABLE = new Set(["quiz", "order", "fill", "think"]);

const flowSource = html.match(/function computeLessonFlowState\(blocks, visibleCount, answeredMap, doneView, reviewMode, hasNext\)\{[\s\S]*?\n\}/);
assert.ok(flowSource, "应存在课程导航状态函数");
const computeLessonFlowState = new Function(
  "ANSWERABLE",
  `${flowSource[0]}; return computeLessonFlowState;`
)(ANSWERABLE);

test("每一关从第一屏开始都同时有返回入口和继续按钮", () => {
  assert.match(html, /lesson-head-back" onclick="renderHome\(\)">← 返回课程/);
  assert.match(html, /<div class="lesson-actions" id="blk-actions">/);
  assert.doesNotMatch(html, /<div class="lesson-actions stepped"/);
  assert.match(html, /id="completeBtn" onclick="advanceLessonFlow\(\)">继续下一环节/);
  assert.doesNotMatch(html, /class="btn-step"/, "同一位置不应叠出第二个继续按钮");
});

test("39 关的每个内容环节都有明确的下一步状态", () => {
  assert.equal(lessons.length, 39);
  for (const lesson of lessons) {
    assert.ok(lesson.blocks.length > 0, `${lesson.id} 不能是空关卡`);
    const answered = {};
    for (let shown = 1; shown < lesson.blocks.length; shown += 1) {
      const current = lesson.blocks[shown - 1];
      let state = computeLessonFlowState(lesson.blocks, shown, answered, false, false, true);
      if (ANSWERABLE.has(current.type)) {
        assert.equal(state.disabled, true, `${lesson.id} 第 ${shown} 环节应先完成练习`);
        assert.equal(state.label, "完成当前练习后继续");
        answered[shown - 1] = true;
        state = computeLessonFlowState(lesson.blocks, shown, answered, false, false, true);
      }
      assert.equal(state.mode, "advance", `${lesson.id} 第 ${shown} 环节应可继续`);
      assert.equal(state.disabled, false, `${lesson.id} 第 ${shown} 环节不应卡住`);
      assert.equal(state.label, "继续下一环节 →");
    }

    lesson.blocks.forEach((block, index) => {
      if (ANSWERABLE.has(block.type)) answered[index] = true;
    });
    const done = computeLessonFlowState(lesson.blocks, lesson.blocks.length, answered, false, false, true);
    assert.equal(done.mode, "complete", `${lesson.id} 末尾应进入通关状态`);
    assert.equal(done.disabled, false, `${lesson.id} 末尾通关按钮应可点击`);
    assert.equal(done.label, "🎉 全部完成,点此通关");
  }
});

test("未完成末尾练习时不误放行，已通关后可进入下一节或返回目录", () => {
  const lesson = lessons.find(item => item.blocks.some(block => ANSWERABLE.has(block.type)));
  const blocked = computeLessonFlowState(lesson.blocks, lesson.blocks.length, {}, false, false, true);
  assert.equal(blocked.disabled, true);
  assert.match(blocked.label, /^还差 \d+ 个练习$/);

  const answered = {};
  lesson.blocks.forEach((block, index) => {
    if (ANSWERABLE.has(block.type)) answered[index] = true;
  });
  assert.equal(
    computeLessonFlowState(lesson.blocks, lesson.blocks.length, answered, true, false, true).label,
    "✓ 已通关 · 进入下一节"
  );
  assert.equal(
    computeLessonFlowState(lesson.blocks, lesson.blocks.length, answered, true, false, false).label,
    "✓ 已通关 · 返回目录"
  );
});

test("同一个主按钮会按状态继续内容或完成关卡", () => {
  const advanceSource = html.match(/function advanceLessonFlow\(\)\{[\s\S]*?\n\}/);
  assert.ok(advanceSource, "应存在主导航点击函数");
  const calls = [];
  const makeAdvance = state => new Function(
    "CUR", "lessonFlowState", "stepNext", "completeLesson",
    `${advanceSource[0]}; return advanceLessonFlow;`
  )(
    { id: "demo" },
    () => state,
    visibleCount => calls.push(["step", visibleCount]),
    () => calls.push(["complete"])
  );

  global._visUpTo = 3;
  makeAdvance({ disabled: true, mode: "advance" })();
  assert.deepEqual(calls, []);

  const advance = new Function(
    "CUR", "lessonFlowState", "stepNext", "completeLesson", "_visUpTo",
    `${advanceSource[0]}; return advanceLessonFlow;`
  )(
    { id: "demo" },
    () => ({ disabled: false, mode: "advance" }),
    visibleCount => calls.push(["step", visibleCount]),
    () => calls.push(["complete"]),
    3
  );
  advance();
  assert.deepEqual(calls, [["step", 3]]);

  makeAdvance({ disabled: false, mode: "complete" })();
  assert.deepEqual(calls, [["step", 3], ["complete"]]);
});

test("积分动画报错时，答对后仍会先推进到下一环节", () => {
  const safeAwardSource = html.match(/function safeAwardXP\(amount, anchor, isCorrect\)\{[\s\S]*?\n\}/);
  const finishSource = html.match(/function finishAnsweredStep\(i, amount, anchor\)\{[\s\S]*?\n\}/);
  assert.ok(safeAwardSource, "应存在不阻塞学习主链的积分保护函数");
  assert.ok(finishSource, "应存在答对后的统一收口函数");

  const calls = [];
  const safeAwardXP = new Function(
    "awardXP", "console",
    `${safeAwardSource[0]}; return safeAwardXP;`
  )(
    () => {
      calls.push("award");
      throw new Error("模拟旧设备积分动画异常");
    },
    { warn: () => calls.push("warn") }
  );
  const finishAnsweredStep = new Function(
    "autoStepNext", "safeAwardXP", "checkComplete",
    `${finishSource[0]}; return finishAnsweredStep;`
  )(
    () => calls.push("advance"),
    safeAwardXP,
    () => calls.push("complete")
  );

  assert.doesNotThrow(() => finishAnsweredStep(4, 10, {}));
  assert.deepEqual(calls, ["advance", "award", "warn", "complete"]);
});
