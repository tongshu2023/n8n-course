import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const cdpBase = process.env.CDP_URL || "http://127.0.0.1:9349";
const pageUrl = process.env.PAGE_URL || pathToFileURL(path.join(process.cwd(), "index.html")).href;
const screenshotPath = process.env.SCREENSHOT_PATH || path.join(os.tmpdir(), "future-letter-e2e.png");
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function newTarget(url) {
  const response = await fetch(`${cdpBase}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建 Chrome 测试页：HTTP ${response.status}`);
  return response.json();
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome 调试连接超时")), 8000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Chrome 调试连接失败"));
      }, { once: true });
    });
    this.socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this.socket && this.socket.readyState < 2) this.socket.close();
  }
}

async function main() {
  const target = await newTarget(pageUrl);
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  const evaluate = async expression => {
    const response = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "页面脚本执行失败");
    return response.result?.value;
  };

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false
    });

    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (await evaluate("typeof COURSE === 'object' && typeof openLesson === 'function'")) break;
      if (attempt === 24) throw new Error("课程脚本没有在 5 秒内加载完成");
      await delay(200);
    }

    const result = await evaluate(`(() => {
      FLAT_IDS.forEach(markDone);
      const renderedFailures = [];
      for (const lesson of FLAT) {
        openLesson(lesson.id, true);
        const renderedTitle = document.querySelector("#view-lesson .lesson-head h2")?.innerText;
        if (renderedTitle !== lesson.title) renderedFailures.push({ id: lesson.id, renderedTitle });
      }
      renderHome();
      const levelCount = document.querySelectorAll("#view-home .level").length;

      const lessonIndex = FLAT_IDS.indexOf("2-future-letter");
      openLesson("2-future-letter", true);
      for (let index = 0; index < CUR.blocks.length - 1; index += 1) {
        document.getElementById("step-" + index)?.click();
      }
      for (const index of [0, 1, 2, 3]) {
        document.querySelector('#pool-4 .node-chip[data-idx="' + index + '"]')?.click();
      }
      document.getElementById("opt-5-0")?.click();
      const think = document.getElementById("think-6");
      think.value = "今天先花十分钟写下第一条选题并保存。";
      think.dispatchEvent(new Event("input", { bubbles: true }));

      const lessonView = document.getElementById("view-lesson");
      const text = lessonView.innerText;
      return {
        lessonCount: FLAT.length,
        levelCount,
        renderedFailures,
        chapterOrder: COURSE.chapters.find(chapter => chapter.id === "ch2").lessons.map(lesson => lesson.id),
        title: lessonView.querySelector(".lesson-head h2")?.innerText,
        hasPrompt: text.includes("你是来自{{ $json.未来年份 }}年的我"),
        hasDeepSeek: text.includes("DeepSeek Chat Model"),
        hasEmail: text.includes("Send Email"),
        orderAnswered: document.getElementById("fb-4")?.innerText.startsWith("✓"),
        quizAnswered: document.getElementById("fb-5")?.innerText.startsWith("✓"),
        thinkAnswered: document.getElementById("fb-6")?.innerText.startsWith("✓"),
        completeEnabled: !document.getElementById("completeBtn")?.disabled,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth
      };
    })()`);

    assert.equal(result.lessonCount, 39);
    assert.equal(result.levelCount, 39);
    assert.deepEqual(result.renderedFailures, []);
    assert.equal(result.title, "🌌 综合练习:来自未来的回信");
    assert.deepEqual(
      result.chapterOrder.slice(result.chapterOrder.indexOf("2-future-letter") - 1, result.chapterOrder.indexOf("2-future-letter") + 2),
      ["2-3", "2-future-letter", "2-err"]
    );
    assert.equal(result.hasPrompt, true);
    assert.equal(result.hasDeepSeek, true);
    assert.equal(result.hasEmail, true);
    assert.equal(result.orderAnswered, true);
    assert.equal(result.quizAnswered, true);
    assert.equal(result.thinkAnswered, true);
    assert.equal(result.completeEnabled, true);
    assert.equal(result.horizontalOverflow, false);

    const image = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    await writeFile(screenshotPath, Buffer.from(image.data, "base64"));
    console.log(JSON.stringify({ ...result, screenshotPath }, null, 2));
  } finally {
    client.close();
    await fetch(`${cdpBase}/json/close/${target.id}`).catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
