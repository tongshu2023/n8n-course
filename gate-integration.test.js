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

test("自学模式通关后自动进入下一关", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /下一关已经自动解锁/);
  assert.match(completeLesson[0], /进入下一关/);
  assert.match(completeLesson[0], /modal\._next = CONFIG\.unlockMode === "manual" \|\| !next \? null : next\.id/);
});
