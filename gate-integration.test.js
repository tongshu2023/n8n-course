"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const data = fs.readFileSync("course-data.js", "utf8");
const config = new Function(data + "; return CONFIG;")();

test("生产配置默认进入教师手动模式", () => {
  assert.equal(config.unlockMode, "manual");
  assert.equal(config.openUpTo, 1);
  assert.match(html, /gate-client\.js/);
});

test("关卡入口自身校验远端闸门", () => {
  const openLesson = html.match(/function openLesson\(id, review\)\{[\s\S]*?\n\}/);
  assert.ok(openLesson, "应存在 openLesson");
  assert.match(openLesson[0], /!isUnlocked\(id\)/);
  assert.match(openLesson[0], /等待老师/);
});

test("通关后固定返回地图，不保存下一关跳转", () => {
  const completeLesson = html.match(/function completeLesson\(\)\{[\s\S]*?\n\}/);
  assert.ok(completeLesson, "应存在 completeLesson");
  assert.match(completeLesson[0], /modal\._next = null/);
  assert.doesNotMatch(completeLesson[0], /modal\._next\s*=\s*next/);
  assert.match(completeLesson[0], /返回关卡地图/);
});

test("已开放范围做完时显示等待老师，不冒充全部结课", () => {
  assert.match(html, /本轮已完成，等待老师开放下一关/);
  assert.match(html, /下一关等待老师开放/);
});
