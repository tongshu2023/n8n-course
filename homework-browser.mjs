import assert from "node:assert/strict";
import os from "node:os";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const cdpBase = process.env.CDP_URL || "http://127.0.0.1:9341";
const projectDir = process.cwd();
const pageUrl = process.env.PAGE_URL || pathToFileURL(path.join(projectDir, "index.html")).href;
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

  const inspect = () => evaluate(`(() => {
    const wrap = document.querySelector(".wrap").getBoundingClientRect();
    const shell = document.querySelector(".homework-shell").getBoundingClientRect();
    const card = document.querySelector(".hw-card").getBoundingClientRect();
    const task = document.querySelector(".hw-task");
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      wrapWidth: Math.round(wrap.width),
      shellWidth: Math.round(shell.width),
      cardWidth: Math.round(card.width),
      taskColumns: getComputedStyle(task).gridTemplateColumns.split(" ").length
    };
  })()`);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await delay(500);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false
    });
    await evaluate("showHomework()");
    await delay(200);
    const desktop = await inspect();
    assert.equal(desktop.viewport, 1440);
    assert.ok(desktop.scrollWidth <= desktop.viewport, "桌面作业页不应横向溢出");
    assert.ok(desktop.wrapWidth >= 1170, `桌面作业容器仍过窄：${desktop.wrapWidth}`);
    assert.ok(desktop.cardWidth >= 1170, `桌面周作业卡仍过窄：${desktop.cardWidth}`);
    assert.equal(desktop.taskColumns, 3, "桌面任务应为题目、要求、标准三栏");

    const image = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    await writeFile(path.join(os.tmpdir(), "homework-desktop-e2e.png"), Buffer.from(image.data, "base64"));

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await delay(200);
    const mobile = await inspect();
    assert.equal(mobile.viewport, 390);
    assert.ok(mobile.scrollWidth <= mobile.viewport, "手机作业页不应横向溢出");
    assert.ok(mobile.cardWidth >= 350, `手机作业卡没有吃满可用宽度：${mobile.cardWidth}`);
    assert.equal(mobile.taskColumns, 1, "手机任务应回落为单栏");

    console.log(JSON.stringify({ desktop, mobile }, null, 2));
  } finally {
    client.close();
    await fetch(`${cdpBase}/json/close/${target.id}`).catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
