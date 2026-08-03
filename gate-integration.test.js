"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const data = fs.readFileSync("course-data.js", "utf8");
const config = new Function(data + "; return CONFIG;")();

test("生产配置恢复自学自动解锁模式", () => {
  assert.equal(config.unlockMode, "auto");
  assert.equal(config.openUpTo, 1);
  assert.match(html, /gate-client\.js/);
  assert.match(html, /course-data\.js\?v=20260803-ch34/);
});

test("自学模式无需班级口令即可直接进入课程", () => {
  assert.match(html, /<section id="view-login" class="hidden">/);
  assert.match(html, /if\(CONFIG\.unlockMode === "auto"\)\{\s*enterApp\(\);/);
  assert.match(html, /logoutBtn[\s\S]*?CONFIG\.unlockMode !== "manual"/);
});

test("后台闸门刷新首页时保留用户滚动位置", () => {
  assert.match(html, /onChange: function\(state\)\{[\s\S]*?renderHome\(\{ preserveScroll: true \}\);/);
  const renderHome = html.match(/function renderHome\(options\)\{[\s\S]*?\n\}/);
  assert.ok(renderHome, "应存在可保留滚动位置的首页渲染函数");
  assert.match(renderHome[0], /const savedScrollY = preserveScroll \? window\.scrollY : 0;/);
  assert.match(renderHome[0], /if\(!preserveScroll\) window\.scrollTo\(0,0\);/);
  assert.match(renderHome[0], /window\.scrollTo\(0, Math\.min\(savedScrollY, maxScrollY\)\);/);
});

test("关卡入口自身校验远端闸门", () => {
  const openLesson = html.match(/function openLesson\(id, review\)\{[\s\S]*?\n\}/);
  assert.ok(openLesson, "应存在 openLesson");
  assert.match(openLesson[0], /!isUnlocked\(id\)/);
  assert.match(openLesson[0], /等待老师/);
});

test("教师模式仍返回地图，不自动越过老师闸门", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /CONFIG\.unlockMode === "manual"/);
  assert.match(completeLesson[0], /返回关卡地图/);
  assert.match(completeLesson[0], /modal\._next = CONFIG\.unlockMode === "manual" \|\| !next \? null : next\.id/);
});

test("教师模式保留等待放行提示，不冒充全部结课", () => {
  assert.match(html, /本轮已完成，等待老师开放下一关/);
  assert.match(html, /下一关等待老师开放/);
});

test("自学模式通关后自动进入下一节", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /下一节已经自动解锁/);
  assert.match(completeLesson[0], /进入下一节/);
  assert.match(completeLesson[0], /modal\._next = CONFIG\.unlockMode === "manual" \|\| !next \? null : next\.id/);
});

test("回看已通关小节时直接进入下一节，末节才返回目录", () => {
  assert.match(html, /function nextLessonAfter\(id\)/);
  assert.match(html, /hasNext \? "✓ 已通关 · 进入下一节" : "✓ 已通关 · 返回目录"/);
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /if\(wasDone && !_reviewMode\)\{[\s\S]*?if\(next\) openLesson\(next\.id\); else renderHome\(\);/);
});

test("已通关按钮的真实点击分支会打开下一节，末节才回目录", () => {
  const nextLessonSource = html.match(/function nextLessonAfter\(id\)\{[\s\S]*?\n\}/);
  const completeLessonSource = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(nextLessonSource && completeLessonSource, "应能读取实际跳转函数");

  const opened = [];
  let homeCount = 0;
  const makeCompleteLesson = new Function(
    "isDone", "CUR", "_reviewMode", "FLAT_IDS", "FLAT", "openLesson", "renderHome",
    `${nextLessonSource[0]}; ${completeLessonSource[0]}; return completeLesson;`
  );
  const flat = [{ id: "lesson-1" }, { id: "lesson-2" }];
  const completeFirst = makeCompleteLesson(
    () => true, { id: "lesson-1" }, false, flat.map(item => item.id), flat,
    id => opened.push(id), () => { homeCount += 1; }
  );
  completeFirst();
  assert.deepEqual(opened, ["lesson-2"]);
  assert.equal(homeCount, 0);

  const completeLast = makeCompleteLesson(
    () => true, { id: "lesson-2" }, false, flat.map(item => item.id), flat,
    id => opened.push(id), () => { homeCount += 1; }
  );
  completeLast();
  assert.deepEqual(opened, ["lesson-2"]);
  assert.equal(homeCount, 1);
});
