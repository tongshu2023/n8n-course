"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");

test("作业入口会切换到独立宽屏容器", () => {
  assert.match(html, /#app\.homework-mode \.wrap\{max-width:1240px/);
  assert.match(html, /#app\.homework-mode \.topbar-inner\{max-width:1240px/);
  assert.match(html, /function showHomework\(\)\{[\s\S]*?classList\.add\("homework-mode"\)/);
  assert.match(html, /function renderHome\(\)\{[\s\S]*?classList\.remove\("homework-mode"\)/);
  assert.match(html, /function openLesson\(id, review\)\{[\s\S]*?classList\.remove\("homework-mode"\)/);
});

test("桌面作业按整周横向展开，窄屏回落为单列", () => {
  assert.match(html, /\.hw-grid\{display:grid;grid-template-columns:1fr/);
  assert.match(
    html,
    /\.hw-task\{[^}]*display:grid;grid-template-columns:minmax\(180px,\.7fr\) minmax\(280px,1\.25fr\) minmax\(300px,1\.25fr\)/
  );
  assert.match(html, /@media\(max-width:960px\)\{[\s\S]*?\.hw-task\{grid-template-columns:1fr/);
  assert.match(html, /class="homework-shell"/);
  assert.match(html, /class="hw-col-label">要做什么/);
  assert.match(html, /class="hw-col-label">怎么算过关/);
});
