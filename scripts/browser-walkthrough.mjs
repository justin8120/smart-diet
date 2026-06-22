import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"

const root = resolve(".")
const distRoot = join(root, "dist")
const appUrl = "http://127.0.0.1:4174"
const debugUrl = "http://127.0.0.1:9222"
const runId = `${process.pid}-${Date.now()}`
const userDataDir = join(tmpdir(), `smart-diet-walkthrough-chrome-${runId}`)
const shouldCaptureScreenshots = process.argv.includes("--screenshots")
const screenshotDir = join(root, "artifacts", "browser-walkthrough")

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function resolveChromePath() {
  const candidates = [
    { label: "CHROME_PATH", path: process.env.CHROME_PATH },
    { label: "PUPPETEER_EXECUTABLE_PATH", path: process.env.PUPPETEER_EXECUTABLE_PATH },
    {
      label: "Windows Program Files",
      path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    },
    {
      label: "Windows Program Files x86",
      path: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    },
    {
      label: "macOS Applications",
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    { label: "Linux google-chrome", path: "/usr/bin/google-chrome" },
    { label: "Linux google-chrome-stable", path: "/usr/bin/google-chrome-stable" },
    { label: "Linux chromium", path: "/usr/bin/chromium" },
    { label: "Linux chromium-browser", path: "/usr/bin/chromium-browser" },
  ]

  const match = candidates.find((candidate) => candidate.path && existsSync(candidate.path))
  if (match?.path) return match.path

  throw new Error(
    [
      "Chrome executable was not found for the browser walkthrough.",
      "Set CHROME_PATH or PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium executable.",
      "Attempted paths:",
      ...candidates.map((candidate) => `- ${candidate.label}: ${candidate.path || "<not set>"}`),
    ].join("\n"),
  )
}

function waitForExit(processHandle, timeoutMs = 3_000) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return Promise.resolve()
  return new Promise((resolveExit) => {
    const timer = setTimeout(resolveExit, timeoutMs)
    processHandle.once("exit", () => {
      clearTimeout(timer)
      resolveExit()
    })
  })
}

function removeDirBestEffort(path) {
  if (!existsSync(path)) return
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  } catch {
    // Chrome can hold profile locks briefly on Windows. These temp paths are unique per run.
  }
}

function killProcessTree(processHandle) {
  if (process.platform === "win32" && processHandle.pid) {
    spawnSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    return
  }
  processHandle.kill()
}

async function waitForHttp(url, label) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Server is not ready yet.
    }
    await delay(250)
  }
  throw new Error(`${label} did not become ready`)
}

function createStaticServer() {
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  }

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", appUrl)
    const pathname = decodeURIComponent(requestUrl.pathname)
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1)
    const filePath = join(distRoot, relativePath)

    try {
      if (!filePath.startsWith(distRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404)
        response.end("Not found")
        return
      }

      const extension = filePath.slice(filePath.lastIndexOf("."))
      response.writeHead(200, {
        "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
      })
      response.end(readFileSync(filePath))
    } catch (error) {
      response.writeHead(500)
      response.end(error instanceof Error ? error.message : "Server error")
    }
  })

  return new Promise((resolveServer) => {
    server.listen(4174, "127.0.0.1", () => resolveServer(server))
  })
}

function spawnHidden(command, args) {
  return spawn(command, args, {
    cwd: root,
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  })
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.events = new Map()
    this.socket = new WebSocket(wsUrl)
  }

  async connect() {
    await new Promise((resolveConnect, rejectConnect) => {
      this.socket.addEventListener("open", resolveConnect, { once: true })
      this.socket.addEventListener("error", rejectConnect, { once: true })
    })

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolveMessage, rejectMessage } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) rejectMessage(new Error(message.error.message))
        else resolveMessage(message.result ?? {})
        return
      }

      const eventWaiters = this.events.get(message.method)
      if (!eventWaiters) return
      this.events.delete(message.method)
      for (const resolveEvent of eventWaiters) resolveEvent(message.params ?? {})
    })
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId
    this.nextId += 1
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId

    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, { resolveMessage, rejectMessage })
      this.socket.send(JSON.stringify(payload))
    })
  }

  once(method) {
    return new Promise((resolveEvent) => {
      const waiters = this.events.get(method) ?? []
      waiters.push(resolveEvent)
      this.events.set(method, waiters)
    })
  }

  close() {
    this.socket.close()
  }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed")
  return result.result.value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function captureScreenshot(client, sessionId, fileName) {
  mkdirSync(screenshotDir, { recursive: true })
  const { data } = await client.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    sessionId,
  )
  writeFileSync(join(screenshotDir, fileName), Buffer.from(data, "base64"))
}

async function main() {
  if (shouldCaptureScreenshots) removeDirBestEffort(screenshotDir)
  mkdirSync(userDataDir, { recursive: true })
  assert(
    existsSync(join(distRoot, "index.html")),
    "dist/index.html does not exist; run npm run build first",
  )

  const server = await createStaticServer()
  const chrome = spawnHidden(resolveChromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9222",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ])

  try {
    await waitForHttp(appUrl, "Static preview server")
    await waitForHttp(`${debugUrl}/json/version`, "Chrome DevTools")

    const { webSocketDebuggerUrl } = await (await fetch(`${debugUrl}/json/version`)).json()
    const client = new CdpClient(webSocketDebuggerUrl)
    await client.connect()

    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true })

    await client.send("Page.enable", {}, sessionId)
    await client.send("Runtime.enable", {}, sessionId)
    await client.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )

    const loaded = client.once("Page.loadEventFired")
    await client.send("Page.navigate", { url: appUrl }, sessionId)
    await loaded

    const desktop = await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        const read = () => ({
          title: document.querySelector("h1")?.textContent,
          nav: [...document.querySelectorAll("nav a")].map((a) => a.textContent.trim()),
          metrics: [...document.querySelectorAll(".metrics span")].map((span) => span.textContent.trim()),
          aiHeading: document.querySelector("#ai-analysis h2")?.textContent,
          body: document.body.textContent,
          mealDataset: [...document.querySelectorAll("#meal-dataset .meal-card h3")].map((heading) => heading.textContent.trim())
        });
        const started = Date.now();
        const timer = setInterval(() => {
          const state = read();
          if (state.metrics[0] !== "載入中" || Date.now() - started > 60000) {
            clearInterval(timer);
            resolve(state);
          }
        }, 250);
      })`,
    )
    assert(desktop.title === "智慧飲食建議系統", "Hero title is not readable")
    assert(
      ["系統介紹", "AI 餐點分析", "餐點推薦", "推薦結果", "餐點資料集", "查詢紀錄"].every((label) =>
        desktop.nav.includes(label),
      ),
      "Navigation labels are incomplete",
    )
    assert(
      desktop.metrics[0] !== "9",
      `Metrics showed raw fallback count: ${desktop.metrics.join(",")}`,
    )
    assert(desktop.metrics[0] !== "載入中", "Metrics remained stuck in loading state")
    assert(desktop.aiHeading === "AI 餐點分析與資料集擴充", "AI analysis section was not rendered")
    const hasBackendData = Number.parseInt(desktop.metrics[0], 10) > 9
    const hasOfflineState = desktop.metrics[0] === "無法取得"
    assert(
      hasBackendData || hasOfflineState,
      `Backend state was unclear: ${desktop.metrics.join(",")}`,
    )
    if (hasOfflineState) {
      assert(
        desktop.body.includes("目前無法連線後端") && desktop.body.includes("離線示範資料"),
        "Offline status was not shown",
      )
    }
    assert(
      desktop.mealDataset.length >= 9 && desktop.mealDataset.includes("茶葉蛋"),
      "Meal dataset did not render",
    )
    if (shouldCaptureScreenshots) await captureScreenshot(client, sessionId, "desktop.png")

    const recommendationFlow = await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        const input = document.querySelector('input[type="search"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "茶葉蛋");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "搜尋 / 推薦").click();
        setTimeout(() => resolve([...document.querySelectorAll("#results .meal-card h3")].map((heading) => heading.textContent.trim())), 100);
      })`,
    )
    assert(
      recommendationFlow.length === 1 && recommendationFlow.includes("茶葉蛋"),
      "Search did not find tea egg",
    )

    const seafoodFilter = await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        const input = document.querySelector('input[type="search"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("#avoid-海鮮").click();
        [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "搜尋 / 推薦").click();
        setTimeout(() => resolve({
          meals: [...document.querySelectorAll("#results .meal-card h3")].map((heading) => heading.textContent.trim()),
          history: document.querySelector("#history")?.textContent ?? ""
        }), 100);
      })`,
    )
    assert(
      !seafoodFilter.meals.includes("海鮮粥") && !seafoodFilter.meals.includes("鮭魚沙拉"),
      "Seafood exclusion failed",
    )
    assert(seafoodFilter.history.includes("結果數量"), "Query history did not record searches")

    const emptyResult = await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        const input = document.querySelector('input[type="search"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "不存在的餐點");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "搜尋 / 推薦").click();
        setTimeout(() => resolve(document.querySelector("#results .empty-state")?.textContent ?? ""), 100);
      })`,
    )
    assert(
      emptyResult.includes("目前沒有符合條件的完整餐點資料"),
      "Empty recommendation state was not shown",
    )

    const anchorResult = await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        document.querySelector('a[href="#meal-dataset"]').click();
        setTimeout(() => resolve({
          hash: location.hash,
          heading: document.querySelector("#meal-dataset h2")?.textContent,
          top: Math.round(document.querySelector("#meal-dataset").getBoundingClientRect().top),
          bottom: Math.round(document.querySelector("#meal-dataset").getBoundingClientRect().bottom),
          height: window.innerHeight
        }), 600);
      })`,
    )
    assert(anchorResult.hash === "#meal-dataset", "Anchor navigation did not update the hash")
    assert(anchorResult.heading === "餐點資料集", "Meal dataset section heading was not reached")
    assert(
      anchorResult.top < anchorResult.height && anchorResult.bottom > 0,
      "Meal dataset section was not visible",
    )

    await client.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      sessionId,
    )
    const mobileLoaded = client.once("Page.loadEventFired")
    await client.send("Page.navigate", { url: appUrl }, sessionId)
    await mobileLoaded
    const mobile = await evaluate(
      client,
      sessionId,
      `(() => {
        const shellRect = document.querySelector(".app-shell").getBoundingClientRect();
        const sidebarRect = document.querySelector(".sidebar").getBoundingClientRect();
        const navColumns = getComputedStyle(document.querySelector("nav")).gridTemplateColumns;
        const firstAction = document.querySelector(".hero-actions a");
        const viewportWidth = document.documentElement.clientWidth;
        const overflowing = [...document.body.querySelectorAll("*")]
          .filter((node) => node.scrollWidth > viewportWidth + 1)
          .map((node) => node.className || node.tagName)
          .slice(0, 5);
        return {
          shellWidth: Math.round(shellRect.width),
          sidebarWidth: Math.round(sidebarRect.width),
          sidebarTop: Math.round(sidebarRect.top),
          navColumns,
          actionWidth: Math.round(firstAction.getBoundingClientRect().width),
          viewportWidth,
          overflowing
        };
      })()`,
    )
    assert(
      mobile.shellWidth <= mobile.viewportWidth,
      `Mobile app shell overflows: ${JSON.stringify(mobile)}`,
    )
    assert(
      mobile.sidebarWidth <= mobile.viewportWidth && mobile.sidebarTop === 0,
      "Mobile sidebar did not collapse",
    )
    assert(!mobile.navColumns.includes(" "), "Mobile navigation did not collapse to one column")
    assert(mobile.actionWidth >= 350, "Mobile action buttons are not full width")
    assert(
      mobile.overflowing.length === 0,
      `Mobile overflow detected: ${mobile.overflowing.join(", ")}`,
    )
    if (shouldCaptureScreenshots) await captureScreenshot(client, sessionId, "mobile.png")

    await client.send("Browser.close").catch(() => undefined)
    client.close()

    console.log("Browser walkthrough passed")
    console.log("- AI analysis section rendered")
    console.log("- Offline backend status appeared for static build")
    console.log("- Offline recommendation flow found tea egg")
    console.log("- Seafood exclusion removed seafood meals")
    console.log("- Empty recommendation state appeared for unmatched search")
    console.log("- Mobile layout collapsed without horizontal overflow")
    if (shouldCaptureScreenshots) console.log(`- Screenshots saved to ${screenshotDir}`)
  } finally {
    killProcessTree(chrome)
    server.close()
    await waitForExit(chrome)
    await delay(500)
    removeDirBestEffort(userDataDir)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
