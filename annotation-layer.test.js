const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const math = require("./annotation-layer.js");

test("手写笔压力会改变笔画粗细，鼠标保持稳定宽度", () => {
  assert.ok(math.widthForPressure("pen", 0.9) > math.widthForPressure("pen", 0.2));
  assert.equal(math.widthForPressure("mouse", 0), math.widthForPressure("mouse", 0.8));
});

test("橡皮擦能把一条笔画从中间擦成两段", () => {
  const stroke = {
    kind: "stroke",
    color: "#ef3340",
    points: Array.from({ length: 11 }, (_, x) => ({ x: x * 4, y: 0, p: 0.5, w: 4 }))
  };
  const chunks = math.splitStrokeByEraser(stroke, 20, 0, 5);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].points.at(-1).x < 15);
  assert.ok(chunks[1].points[0].x > 25);
});

test("三个教学页面均已内嵌同一套画笔，课程页按页面隔离标注", () => {
  const root = __dirname;
  for (const file of ["index.html", "open-class.html", "build.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /annotation-layer\.js\?v=20260729a/, `${file} 应加载画笔`);
  }
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(index, /AnnotationLayer\.setPage\("course-home"\)/);
  assert.match(index, /AnnotationLayer\.setPage\("course-homework"\)/);
  assert.match(index, /AnnotationLayer\.setPage\(`lesson:\$\{id\}`\)/);
});

test("实现包含三色、文字、清空、高清画布和合并笔迹事件", () => {
  const source = fs.readFileSync(path.join(__dirname, "annotation-layer.js"), "utf8");
  for (const color of ["#ef3340", "#16a365", "#2563eb"]) assert.match(source, new RegExp(color));
  assert.match(source, /输入文字/);
  assert.match(source, /清空当前页面/);
  assert.match(source, /devicePixelRatio/);
  assert.match(source, /getCoalescedEvents/);
  assert.match(source, /touch-action:none/);
});

test("修改后的三个页面内联脚本都能通过语法解析", () => {
  for (const file of ["index.html", "open-class.html", "build.html"]) {
    const html = fs.readFileSync(path.join(__dirname, file), "utf8");
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(inlineScripts.length > 0, `${file} 应有内联脚本`);
    inlineScripts.forEach((match, index) => {
      assert.doesNotThrow(() => new Function(match[1]), `${file} 第 ${index + 1} 段内联脚本语法错误`);
    });
  }
});
