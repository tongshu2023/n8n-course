"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const source = fs.readFileSync("course-data.js", "utf8");
const course = new Function(`${source}; return COURSE;`)();
const lessons = course.chapters.flatMap(chapter => chapter.lessons);

test("所有关卡 ID 唯一，避免覆盖既有学习进度", () => {
  const ids = lessons.map(lesson => lesson.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("来自未来的回信是第二章的独立关卡，位于成品②和排错卡之间", () => {
  const chapter = course.chapters.find(item => item.id === "ch2");
  assert.ok(chapter, "应存在第二章");
  const ids = chapter.lessons.map(lesson => lesson.id);
  const futureIndex = ids.indexOf("2-future-letter");
  assert.ok(futureIndex > -1, "应存在来自未来的回信关卡");
  assert.equal(ids[futureIndex - 1], "2-3");
  assert.equal(ids[futureIndex + 1], "2-err");
});

test("来自未来的回信完整复习字段、DeepSeek、表达式和邮件发送", () => {
  const lesson = lessons.find(item => item.id === "2-future-letter");
  const content = JSON.stringify(lesson);
  for (const required of [
    "Manual Trigger",
    "Edit Fields",
    "Basic LLM Chain",
    "DeepSeek Chat Model",
    "Send Email",
    "{{ $json.未来年份 }}",
    "{{ $json.现在的困扰 }}",
    "{{ $json.未来目标 }}",
    "{{ $json.text }}"
  ]) {
    assert.match(content, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
