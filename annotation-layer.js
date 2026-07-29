(function (global) {
  "use strict";

  const math = {
    normalizePressure(pointerType, pressure) {
      if (pointerType === "pen" && Number.isFinite(pressure) && pressure > 0) {
        return Math.max(0.08, Math.min(1, pressure));
      }
      return 0.5;
    },

    widthForPressure(pointerType, pressure) {
      const p = math.normalizePressure(pointerType, pressure);
      return pointerType === "pen" ? 2.2 + p * 5.8 : 4.4;
    },

    distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    },

    splitStrokeByEraser(stroke, x, y, radius) {
      const chunks = [];
      let chunk = [];
      for (const point of stroke.points || []) {
        if (Math.hypot(point.x - x, point.y - y) <= radius) {
          if (chunk.length) chunks.push(chunk);
          chunk = [];
        } else {
          chunk.push(point);
        }
      }
      if (chunk.length) chunks.push(chunk);
      return chunks
        .filter((points) => points.length > 0)
        .map((points) => Object.assign({}, stroke, { points }));
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = math;
  global.AnnotationLayerMath = math;
  if (typeof document === "undefined") return;

  const COLORS = {
    red: "#ef3340",
    green: "#16a365",
    blue: "#2563eb"
  };
  const pages = new Map();
  let pageKey = location.pathname || "page";
  let pageItems = [];
  let open = false;
  let tool = "pen";
  let color = COLORS.red;
  let activePointer = null;
  let activeStroke = null;
  let eraseQueued = null;
  let raf = 0;
  let dpr = 1;
  let ctx;
  let canvas;
  let root;
  let panel;
  let launcher;
  let textEditor = null;

  function makeButton(label, title, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "annotation-tool";
    button.setAttribute("aria-label", title || label);
    button.title = title || label;
    button.innerHTML = label;
    return button;
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #annotation-layer-root{position:fixed;inset:0;z-index:1200;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
      #annotation-layer-root.annotation-hidden{display:none}
      #annotation-canvas{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;touch-action:none}
      #annotation-canvas.is-active{pointer-events:auto}
      #annotation-launcher{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));width:50px;height:50px;border:0;border-radius:50%;background:#1d1d1f;color:#fff;box-shadow:0 8px 26px rgba(0,0,0,.22);font-size:22px;pointer-events:auto;cursor:pointer;display:grid;place-items:center;transition:transform .16s,box-shadow .16s}
      #annotation-launcher:hover{transform:translateY(-2px);box-shadow:0 11px 30px rgba(0,0,0,.26)}
      #annotation-launcher:focus-visible,.annotation-tool:focus-visible,.annotation-color:focus-visible{outline:3px solid rgba(37,99,235,.35);outline-offset:3px}
      #annotation-toolbar{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:7px;padding:8px;background:rgba(255,255,255,.94);border:1px solid rgba(20,20,20,.12);border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.2);backdrop-filter:blur(18px);pointer-events:auto;max-width:calc(100vw - 24px)}
      #annotation-toolbar.is-open{display:flex}
      .annotation-color,.annotation-tool{width:42px;height:42px;flex:0 0 42px;border:0;border-radius:12px;background:#f2f2f2;color:#252525;display:grid;place-items:center;cursor:pointer;font:600 15px/1 inherit;transition:background .14s,transform .14s,box-shadow .14s}
      .annotation-color{position:relative;background:transparent}
      .annotation-color::after{content:"";width:22px;height:22px;border-radius:50%;background:var(--swatch);box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
      .annotation-color[aria-pressed="true"]{box-shadow:inset 0 0 0 2px #1d1d1f}
      .annotation-tool[aria-pressed="true"]{background:#1d1d1f;color:#fff}
      .annotation-tool:hover,.annotation-color:hover{transform:translateY(-1px)}
      .annotation-separator{width:1px;height:28px;background:rgba(0,0,0,.12);margin:0 1px;flex:0 0 1px}
      .annotation-clear{color:#c62828}
      #annotation-text-editor{position:fixed;z-index:1202;width:min(280px,calc(100vw - 28px));min-height:46px;padding:9px 11px;border:2px solid currentColor;border-radius:10px;background:rgba(255,255,255,.96);box-shadow:0 8px 26px rgba(0,0,0,.18);resize:none;overflow:hidden;font:600 24px/1.25 "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;outline:none;pointer-events:auto}
      html.annotation-drawing,html.annotation-drawing body{overscroll-behavior:none}
      @media(max-width:620px){
        #annotation-toolbar{left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));transform:none;overflow-x:auto;justify-content:flex-start;border-radius:16px;scrollbar-width:none}
        #annotation-toolbar::-webkit-scrollbar{display:none}
        .annotation-color,.annotation-tool{width:40px;height:40px;flex-basis:40px}
      }
      @media(prefers-reduced-motion:reduce){#annotation-launcher,.annotation-tool,.annotation-color{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function buildUi() {
    injectStyles();
    root = document.createElement("div");
    root.id = "annotation-layer-root";
    if (document.body.hasAttribute("data-annotation-deferred")) {
      root.classList.add("annotation-hidden");
    }

    canvas = document.createElement("canvas");
    canvas.id = "annotation-canvas";
    canvas.setAttribute("aria-label", "网页书写画布");
    ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

    launcher = makeButton("✎", "打开画笔", "");
    launcher.id = "annotation-launcher";
    launcher.addEventListener("click", () => setOpen(true));

    panel = document.createElement("div");
    panel.id = "annotation-toolbar";
    panel.setAttribute("role", "toolbar");
    panel.setAttribute("aria-label", "网页画笔工具");

    Object.entries(COLORS).forEach(([name, value]) => {
      const label = name === "red" ? "红色画笔" : name === "green" ? "绿色画笔" : "蓝色画笔";
      const button = makeButton("", label, "annotation-color");
      button.style.setProperty("--swatch", value);
      button.dataset.color = value;
      button.setAttribute("aria-pressed", value === color ? "true" : "false");
      button.addEventListener("click", () => {
        color = value;
        setTool("pen");
        updateButtons();
      });
      panel.appendChild(button);
    });

    panel.appendChild(separator());
    const eraser = makeButton("⌫", "橡皮擦", "annotation-tool");
    eraser.dataset.tool = "eraser";
    eraser.addEventListener("click", () => setTool("eraser"));
    panel.appendChild(eraser);

    const text = makeButton("T", "输入文字", "annotation-tool");
    text.dataset.tool = "text";
    text.addEventListener("click", () => setTool("text"));
    panel.appendChild(text);

    panel.appendChild(separator());
    const clear = makeButton("清", "清空当前页面的全部标注", "annotation-tool annotation-clear");
    clear.addEventListener("click", clearPage);
    panel.appendChild(clear);

    const close = makeButton("×", "收起画笔并恢复网页操作", "annotation-tool");
    close.addEventListener("click", () => setOpen(false));
    panel.appendChild(close);

    root.append(canvas, launcher, panel);
    document.body.appendChild(root);
    resizeCanvas();
    bindEvents();
    updateButtons();
  }

  function separator() {
    const el = document.createElement("span");
    el.className = "annotation-separator";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  function setOpen(next) {
    open = !!next;
    panel.classList.toggle("is-open", open);
    launcher.style.display = open ? "none" : "grid";
    canvas.classList.toggle("is-active", open);
    document.documentElement.classList.toggle("annotation-drawing", open);
    if (!open) {
      commitTextEditor();
      activePointer = null;
      activeStroke = null;
      canvas.style.cursor = "";
    } else {
      canvas.style.cursor = tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair";
    }
  }

  function setTool(next) {
    commitTextEditor();
    tool = next;
    canvas.style.cursor = tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair";
    updateButtons();
  }

  function updateButtons() {
    panel.querySelectorAll(".annotation-color").forEach((button) => {
      button.setAttribute("aria-pressed", tool === "pen" && button.dataset.color === color ? "true" : "false");
    });
    panel.querySelectorAll("[data-tool]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.tool === tool ? "true" : "false");
    });
  }

  function currentPage() {
    if (!pages.has(pageKey)) pages.set(pageKey, []);
    pageItems = pages.get(pageKey);
    return pageItems;
  }

  function setPage(next) {
    commitTextEditor();
    pageKey = `${location.pathname || "page"}::${next || "default"}`;
    currentPage();
    scheduleRedraw();
  }

  function resizeCanvas() {
    dpr = Math.max(1, Math.min(3, global.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(global.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(global.innerHeight * dpr));
    canvas.style.width = `${global.innerWidth}px`;
    canvas.style.height = `${global.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scheduleRedraw();
  }

  function scheduleRedraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      redraw();
    });
  }

  function redraw() {
    ctx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    for (const item of currentPage()) {
      if (item.kind === "stroke") drawStroke(item);
      else if (item.kind === "text") drawText(item);
    }
  }

  function drawStroke(stroke) {
    const points = stroke.points || [];
    if (!points.length) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "source-over";
    if (points.length === 1) {
      const p = points[0];
      ctx.beginPath();
      ctx.arc(p.x - global.scrollX, p.y - global.scrollY, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < points.length; i++) drawSegment(points[i - 1], points[i], stroke.color);
    }
    ctx.restore();
  }

  function drawSegment(a, b, strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = (a.w + b.w) / 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x - global.scrollX, a.y - global.scrollY);
    ctx.lineTo(b.x - global.scrollX, b.y - global.scrollY);
    ctx.stroke();
  }

  function drawText(item) {
    const lines = String(item.text || "").split(/\r?\n/);
    const lineHeight = item.size * 1.25;
    ctx.save();
    ctx.fillStyle = item.color;
    ctx.font = `600 ${item.size}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = "top";
    item.w = 0;
    lines.forEach((line, index) => {
      ctx.fillText(line, item.x - global.scrollX, item.y - global.scrollY + index * lineHeight);
      item.w = Math.max(item.w, ctx.measureText(line || " ").width);
    });
    item.h = Math.max(lineHeight, lines.length * lineHeight);
    ctx.restore();
  }

  function eventPoint(event) {
    return {
      x: event.clientX + global.scrollX,
      y: event.clientY + global.scrollY,
      p: math.normalizePressure(event.pointerType, event.pressure),
      w: math.widthForPressure(event.pointerType, event.pressure)
    };
  }

  function appendPoint(stroke, point) {
    const points = stroke.points;
    const previous = points[points.length - 1];
    if (!previous) {
      points.push(point);
      return [point];
    }
    const distance = math.distance(previous, point);
    if (distance < 0.35) return [];
    const steps = Math.max(1, Math.ceil(distance / 3.5));
    const added = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const next = {
        x: previous.x + (point.x - previous.x) * t,
        y: previous.y + (point.y - previous.y) * t,
        p: previous.p + (point.p - previous.p) * t,
        w: previous.w + (point.w - previous.w) * t
      };
      points.push(next);
      added.push(next);
    }
    return added;
  }

  function beginStroke(event) {
    activeStroke = { kind: "stroke", color, points: [] };
    currentPage().push(activeStroke);
    appendPoint(activeStroke, eventPoint(event));
    drawStroke(activeStroke);
  }

  function continueStroke(event) {
    if (!activeStroke) return;
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    for (const sample of events.length ? events : [event]) {
      const before = activeStroke.points[activeStroke.points.length - 1];
      const added = appendPoint(activeStroke, eventPoint(sample));
      let previous = before;
      for (const point of added) {
        if (previous) drawSegment(previous, point, activeStroke.color);
        previous = point;
      }
    }
  }

  function queueErase(event) {
    eraseQueued = eventPoint(event);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!eraseQueued) return;
      eraseAt(eraseQueued.x, eraseQueued.y);
      eraseQueued = null;
      redraw();
    });
  }

  function eraseAt(x, y) {
    const radius = 17;
    const next = [];
    for (const item of currentPage()) {
      if (item.kind === "stroke") {
        next.push(...math.splitStrokeByEraser(item, x, y, radius));
      } else if (item.kind === "text") {
        const w = item.w || String(item.text || "").length * item.size;
        const h = item.h || item.size * 1.25;
        const nearestX = Math.max(item.x, Math.min(x, item.x + w));
        const nearestY = Math.max(item.y, Math.min(y, item.y + h));
        if (Math.hypot(x - nearestX, y - nearestY) > radius) next.push(item);
      }
    }
    pages.set(pageKey, next);
    pageItems = next;
  }

  function openTextEditor(event) {
    commitTextEditor();
    const point = eventPoint(event);
    textEditor = document.createElement("textarea");
    textEditor.id = "annotation-text-editor";
    textEditor.rows = 1;
    textEditor.placeholder = "输入文字";
    textEditor.setAttribute("aria-label", "输入要写在页面上的文字");
    textEditor.style.color = color;
    textEditor.style.left = `${Math.min(event.clientX, global.innerWidth - Math.min(294, global.innerWidth - 14))}px`;
    textEditor.style.top = `${Math.min(event.clientY, global.innerHeight - 74)}px`;
    textEditor.dataset.x = String(point.x);
    textEditor.dataset.y = String(point.y);
    textEditor.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        cancelTextEditor();
      } else if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
        keyEvent.preventDefault();
        commitTextEditor();
      }
    });
    textEditor.addEventListener("input", () => {
      textEditor.style.height = "auto";
      textEditor.style.height = `${Math.min(180, textEditor.scrollHeight)}px`;
    });
    textEditor.addEventListener("blur", () => setTimeout(commitTextEditor, 0), { once: true });
    root.appendChild(textEditor);
    requestAnimationFrame(() => textEditor && textEditor.focus());
  }

  function commitTextEditor() {
    if (!textEditor) return;
    const editor = textEditor;
    textEditor = null;
    const text = editor.value.trim();
    if (text) {
      currentPage().push({
        kind: "text",
        text,
        x: Number(editor.dataset.x),
        y: Number(editor.dataset.y),
        size: 24,
        color
      });
    }
    editor.remove();
    scheduleRedraw();
  }

  function cancelTextEditor() {
    if (!textEditor) return;
    const editor = textEditor;
    textEditor = null;
    editor.remove();
  }

  function clearPage() {
    commitTextEditor();
    if (!currentPage().length) return;
    if (!global.confirm("清空当前页面的全部画笔和文字？")) return;
    pages.set(pageKey, []);
    pageItems = pages.get(pageKey);
    scheduleRedraw();
  }

  function bindEvents() {
    canvas.addEventListener("pointerdown", (event) => {
      if (!open || activePointer !== null) return;
      event.preventDefault();
      if (tool === "text") {
        openTextEditor(event);
        return;
      }
      activePointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      if (tool === "eraser") queueErase(event);
      else beginStroke(event);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!open || event.pointerId !== activePointer) return;
      event.preventDefault();
      if (tool === "eraser") queueErase(event);
      else continueStroke(event);
    });

    const endPointer = (event) => {
      if (event.pointerId !== activePointer) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      activePointer = null;
      activeStroke = null;
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("contextmenu", (event) => {
      if (open) event.preventDefault();
    });

    global.addEventListener("resize", resizeCanvas, { passive: true });
    global.addEventListener("scroll", scheduleRedraw, { passive: true });
    if (global.visualViewport) {
      global.visualViewport.addEventListener("resize", resizeCanvas, { passive: true });
      global.visualViewport.addEventListener("scroll", scheduleRedraw, { passive: true });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open && !textEditor) setOpen(false);
    });
  }

  function show() {
    root.classList.remove("annotation-hidden");
  }

  function hide() {
    setOpen(false);
    root.classList.add("annotation-hidden");
  }

  buildUi();
  currentPage();
  global.AnnotationLayer = {
    show,
    hide,
    setPage,
    open: () => setOpen(true),
    close: () => setOpen(false),
    clear: clearPage,
    getPageKey: () => pageKey
  };
})(typeof window !== "undefined" ? window : globalThis);
