"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const data = fs.readFileSync("course-data.js", "utf8");
const config = new Function(data + "; return CONFIG;")();

test("生产配置为老师手动闸门模式", () => {
  assert.equal(config.unlockMode, "manual");
  assert.equal(config.openUpTo, 1);
  assert.match(html, /gate-client\.js/);
  assert.match(html, /course-data\.js\?v=20260810-ch6peak/);
});

test("锁定优先:老师收回的关卡不显示已通关且不可点击", () => {
  assert.match(html, /dn = un && isDone\(ls\.id\)/);
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

test("教师模式只在下一关未开放或章节结束时返回地图", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /const readyNext = nextReadyLessonAfter\(CUR\.id\)/);
  assert.match(completeLesson[0], /返回关卡地图/);
  assert.match(completeLesson[0], /modal\._next = readyNext \? readyNext\.id : null/);
});

test("教师已开放同章下一关时直接进入", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /下一关已由老师开放，可以直接进入/);
  assert.match(completeLesson[0], /readyNext \? "进入下一关" : "返回关卡地图"/);
});

test("教师模式保留等待放行提示，不冒充全部结课", () => {
  assert.match(html, /本轮已完成，等待老师开放下一关/);
  assert.match(html, /下一关等待老师开放/);
});

test("自学模式通关后自动进入下一节", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /下一关已经自动解锁/);
  assert.match(completeLesson[0], /进入下一关/);
  assert.match(completeLesson[0], /modal\._next = readyNext \? readyNext\.id : null/);
});

test("回看已通关小节时直接进入同章下一关，章节末尾返回目录", () => {
  assert.match(html, /function nextLessonAfter\(id\)/);
  assert.match(html, /hasNext \? "✓ 已通关 · 进入下一节" : "✓ 已通关 · 返回目录"/);
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /if\(wasDone && !_reviewMode\)\{[\s\S]*?nextReadyLessonAfter\(CUR\.id\)[\s\S]*?if\(next\) openLesson\(next\.id\); else renderHome\(\);/);
});

test("已通关按钮只打开同章且已开放的下一关", () => {
  const nextLessonSource = html.match(/function nextLessonAfter\(id\)\{[\s\S]*?\n\}/);
  const nextReadySource = html.match(/function nextReadyLessonAfter\(id\)\{[\s\S]*?\n\}/);
  const completeLessonSource = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(nextLessonSource && nextReadySource && completeLessonSource, "应能读取实际跳转函数");

  const opened = [];
  let homeCount = 0;
  const makeCompleteLesson = new Function(
    "isDone", "isUnlocked", "CUR", "_reviewMode", "COURSE", "openLesson", "renderHome",
    `${nextLessonSource[0]}; ${nextReadySource[0]}; ${completeLessonSource[0]}; return completeLesson;`
  );
  const course = { chapters: [
    { lessons: [{ id: "1-1" }, { id: "1-2" }] },
    { lessons: [{ id: "2-1" }, { id: "2-2" }] }
  ] };
  const completeFirst = makeCompleteLesson(
    () => true, () => true, { id: "1-1" }, false, course,
    id => opened.push(id), () => { homeCount += 1; }
  );
  completeFirst();
  assert.deepEqual(opened, ["1-2"]);
  assert.equal(homeCount, 0);

  const completeLocked = makeCompleteLesson(
    () => true, () => false, { id: "1-1" }, false, course,
    id => opened.push(id), () => { homeCount += 1; }
  );
  completeLocked();
  assert.deepEqual(opened, ["1-2"]);
  assert.equal(homeCount, 1);

  const completeChapterLast = makeCompleteLesson(
    () => true, () => true, { id: "1-2" }, false, course,
    id => opened.push(id), () => { homeCount += 1; }
  );
  completeChapterLast();
  assert.deepEqual(opened, ["1-2"]);
  assert.equal(homeCount, 2);
});

test("首次通关弹窗的真实按钮去向：同章已开放则下一关，章节结束则地图", () => {
  const nextLessonSource = html.match(/function nextLessonAfter\(id\)\{[\s\S]*?\n\}/);
  const nextReadySource = html.match(/function nextReadyLessonAfter\(id\)\{[\s\S]*?\n\}/);
  const completeLessonSource = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  const closeModalSource = html.match(/function closeModal\(\)\{[\s\S]*?\n\}/);
  assert.ok(nextLessonSource && nextReadySource && completeLessonSource && closeModalSource, "应能读取弹窗真实点击链路");

  const course = { chapters: [
    { lessons: [{ id: "1-1" }, { id: "1-2" }] },
    { lessons: [{ id: "2-1" }] }
  ] };
  const run = ({ currentId, unlocked }) => {
    const elements = {
      modal: { _next: null, classList: { add() {}, remove() {} } },
      modalEmoji: {},
      modalTitle: {},
      modalDesc: {},
      modalBtn: {},
      completeBtn: {}
    };
    const opened = [];
    let homeCount = 0;
    const document = { getElementById: id => elements[id] };
    const completeLesson = new Function(
      "isDone", "isUnlocked", "CUR", "_reviewMode", "COURSE", "markDone", "safeAwardXP", "getDone", "FLAT",
      "document", "CONFIG", "openLesson", "renderHome",
      `${nextLessonSource[0]}; ${nextReadySource[0]}; ${completeLessonSource[0]}; return completeLesson;`
    )(
      () => false, () => unlocked, { id: currentId, milestone: false }, false, course, () => {}, () => {},
      () => new Set([currentId]), [{}, {}, {}, {}], document, { unlockMode: "manual" },
      id => opened.push(id), () => { homeCount += 1; }
    );
    const closeModal = new Function(
      "document", "openLesson", "renderHome",
      `${closeModalSource[0]}; return closeModal;`
    )(document, id => opened.push(id), () => { homeCount += 1; });

    completeLesson();
    closeModal();
    return { elements, opened, homeCount };
  };

  const withinChapter = run({ currentId: "1-1", unlocked: true });
  assert.equal(withinChapter.elements.modalBtn.textContent, "进入下一关");
  assert.match(withinChapter.elements.modalDesc.textContent, /可以直接进入/);
  assert.deepEqual(withinChapter.opened, ["1-2"]);
  assert.equal(withinChapter.homeCount, 0);

  const chapterEnd = run({ currentId: "1-2", unlocked: true });
  assert.equal(chapterEnd.elements.modalBtn.textContent, "返回关卡地图");
  assert.match(chapterEnd.elements.modalDesc.textContent, /本章已完成/);
  assert.deepEqual(chapterEnd.opened, []);
  assert.equal(chapterEnd.homeCount, 1);
});
