"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync("course-data.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const course = new Function(`${source}; return COURSE;`)();
const chapter3 = course.chapters.find(chapter => chapter.id === "ch3");
const chapter4 = course.chapters.find(chapter => chapter.id === "ch4");

test("第三章保持四节并形成 RSS+TikHub 取数到原创成稿的闭环", () => {
  assert.deepEqual(chapter3.lessons.map(lesson => lesson.id), ["3-1", "3-2", "3-3", "3-multi"]);
  const content = JSON.stringify(chapter3);
  for (const required of [
    "RSS",
    "TikHub",
    "HTTP Request",
    "06_抖音数据获取.json",
    "Import from File",
    "CSV",
    "借需求",
    "参数化",
    "岗位对比表",
    "房源对比表"
  ]) assert.match(content, new RegExp(required));
});

test("第四章保持三节并围绕三大结构与逐字稿流水线", () => {
  assert.deepEqual(chapter4.lessons.map(lesson => lesson.id), ["4-1", "4-clean", "4-2"]);
  const content = JSON.stringify(chapter4);
  for (const required of [
    "顺序",
    "分支",
    "循环",
    "IF",
    "1966",
    "异步",
    "task_id",
    "小票",
    "paraformer",
    "轮询",
    "等 30 秒",
    "04_抖音逐字稿流水线.json",
    "逐字稿",
    "13 列"
  ]) assert.match(content, new RegExp(required));
});

test("每节都写清可带走能力、目标和可完成的练习", () => {
  for (const lesson of [...chapter3.lessons, ...chapter4.lessons]) {
    assert.ok(lesson.canDo, `${lesson.id} 缺少 canDo`);
    assert.ok(lesson.goal, `${lesson.id} 缺少 goal`);
    assert.ok(lesson.blocks.some(block => ["lab", "think", "quiz", "order"].includes(block.type)), `${lesson.id} 缺少练习`);
  }
});

test("取数和简报模板结构完整且不存在真实密钥", () => {
  for (const name of ["06_抖音数据获取.json", "03_从对标表到原创成稿.json", "04_抖音逐字稿流水线.json"]) {
    const full = path.join("workflows", name);
    const raw = fs.readFileSync(full, "utf8");
    const workflow = JSON.parse(raw);
    const names = new Set(workflow.nodes.map(node => node.name));
    assert.ok(workflow.nodes.length >= 5, `${name} 节点不足`);
    for (const [from, groups] of Object.entries(workflow.connections)) {
      assert.ok(names.has(from), `${name} 的连接起点 ${from} 不存在`);
      for (const outputs of Object.values(groups)) {
        for (const output of outputs) {
          for (const edge of output) assert.ok(names.has(edge.node), `${name} 的连接终点 ${edge.node} 不存在`);
        }
      }
    }
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9_-]{12,}/);
  }
});

test("课程页面为所有带模板的实操提供真实下载入口", () => {
  assert.match(html, /href="workflows\/\$\{encodeURIComponent\(b\.workflow\)\}"/);
  assert.match(html, /下载工作流模板/);
  for (const chapter of [chapter3, chapter4]) {
    for (const lesson of chapter.lessons) {
      for (const block of lesson.blocks.filter(item => item.workflow)) {
        assert.ok(fs.existsSync(path.join("workflows", block.workflow)), `${block.workflow} 不存在`);
      }
    }
  }
});

test("第四章小票流程在说明上方提供逐字稿工作流下载", () => {
  const lesson = chapter4.lessons.find(item => item.id === "4-clean");
  const lab = lesson.blocks.find(item => item.type === "lab");
  assert.equal(lab.workflow, "04_抖音逐字稿流水线.json");
  assert.equal(lab.downloadFirst, true);
  assert.ok(fs.existsSync(path.join("workflows", lab.workflow)));
});

test("教学备用数据明确标注为虚构样本", () => {
  const sample = JSON.parse(fs.readFileSync(path.join("assets", "bilibili-practice-data.json"), "utf8"));
  assert.match(sample.notice, /教学备用数据/);
  assert.match(sample.notice, /虚构示例/);
  assert.ok(sample.data.length >= 6);
  assert.ok(sample.data.every(item => item.is_demo === true));
});
