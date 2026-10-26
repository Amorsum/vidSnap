"""仅对显式加载 mock-upstream.mjs 的隔离生产服务验收，无真实媒体或模型调用。"""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3426"
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else "tmp/learning-browser")
CODE = "isolation-test-only"
VIDEO = "https://youtu.be/dQw4w9WgXcQ"
CHECKS = []


async def saved_notes(page):
    return await page.evaluate("""() => new Promise((resolve, reject) => {
      const request = indexedDB.open('vidsnap-notebook', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('notes', 'readonly');
        const read = tx.objectStore('notes').getAll();
        tx.oncomplete = () => { db.close(); resolve(read.result); };
        tx.onabort = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    })""")


async def analyze(page):
    await page.get_by_role("textbox", name="视频链接", exact=True).fill(VIDEO)
    async with page.expect_response(lambda r: r.url.endswith("/api/process") and r.request.method == "POST") as response:
        await page.get_by_role("button", name="开始解析", exact=True).click()
    data = await response.value
    assert data.status == 200
    await page.get_by_text("隔离测试总结", exact=True).wait_for()
    await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
    return max(await saved_notes(page), key=lambda n: n["lastViewedAt"])["analysis"]


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, reduced_motion="reduce")
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            response = await page.goto(BASE, wait_until="networkidle")
            assert response.headers.get("x-vidsnap-test-mocks") == "1", "必须使用隔离的测试替身服务"
            await page.get_by_placeholder("请输入访问码").fill("wrong-code")
            await page.get_by_role("button", name="进入 VidSnap").click()
            await page.get_by_text("访问码错误", exact=True).wait_for()
            await page.get_by_placeholder("请输入访问码").fill(CODE)
            await page.get_by_role("button", name="进入 VidSnap").click()
            await page.get_by_role("textbox", name="视频链接", exact=True).wait_for()
            initial = await analyze(page)
            assert initial["transcription"] == {"provider": "builtin", "timing": "source"}
            assert initial["vision"]["outcome"] == "completed"
            CHECKS.append("门禁、真实路由 SSE、字幕与视觉来源")

            await page.get_by_role("button", name="定位到 00:01", exact=True).click()
            await page.get_by_text("正在核对 00:01", exact=True).wait_for()
            assert await page.get_by_text("这是隔离测试字幕。", exact=True).is_visible()
            link = page.get_by_role("link", name="打开原视频 00:01", exact=True)
            assert "t=1s" in await link.get_attribute("href")
            await page.get_by_role("button", name="返回字幕搜索", exact=True).click()
            await page.get_by_role("searchbox", name="搜索字幕", exact=True).fill("说明")
            await page.get_by_text("1 / 1", exact=True).wait_for()
            assert await page.locator("mark").inner_text() == "说明"
            await page.get_by_role("searchbox", name="搜索字幕", exact=True).fill("不存在的词")
            await page.get_by_text("没有找到匹配字幕", exact=True).wait_for()
            CHECKS.append("时间引用联动、YouTube 时间外链、字幕搜索及空状态")

            await page.get_by_role("tab", name="总结", exact=True).click()
            await page.get_by_role("button", name="解释这一段", exact=True).click()
            await page.get_by_text("模拟追问回答", exact=False).last.wait_for()
            await page.get_by_role("tab", name="总结", exact=True).click()
            await page.get_by_label("我的笔记", exact=True).fill("实践：用自己的语言解释视频核心观点。")
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            local = await saved_notes(page)
            assert len(local) == 1 and local[0]["personalNote"].startswith("实践")
            assert len(local[0]["turns"]) == 1
            assert all("src" not in f for f in local[0]["analysis"]["frames"])
            assert "token=" not in json.dumps(local, ensure_ascii=False)
            CHECKS.append("章节解释、成功问答与个人笔记自动保存、剥离帧签名")

            await page.get_by_label("包含字幕原文", exact=True).check()
            async with page.expect_download() as download:
                await page.get_by_role("button", name="导出 Markdown", exact=True).click()
            exported = OUTPUT / "note.md"
            await (await download.value).save_as(exported)
            text = exported.read_text(encoding="utf-8")
            assert all(part in text for part in ["实践", "字幕原文", "这是隔离测试字幕", "模拟追问回答", "画面依据"])
            CHECKS.append("Markdown 实际下载与导出内容")

            await page.reload(wait_until="networkidle")
            await page.get_by_label("我的笔记", exact=True).wait_for()
            assert (await page.get_by_label("我的笔记", exact=True).input_value()).startswith("实践")
            assert await page.locator('img[src^="/api/frames"]').count() == 0
            assert await page.get_by_text("画面已过期或未保存在本地", exact=False).count() == 3
            await page.get_by_role("textbox", name="追问视频内容", exact=True).wait_for(state="visible")
            await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
            await analyze(page)
            assert len(await saved_notes(page)) == 1
            CHECKS.append("刷新恢复、在线可用性检查、缓存复用不重复建笔记")

            for width, height in [(1440, 1000), (768, 1024), (390, 844)]:
                await page.set_viewport_size({"width": width, "height": height})
                await page.get_by_role("tab", name="总结", exact=True).click()
                await page.screenshot(path=str(OUTPUT / f"summary-{width}.png"), full_page=True)
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.get_by_role("tab", name="追问", exact=True).click()
                composer = page.get_by_role("textbox", name="追问视频内容", exact=True)
                if width >= 1280:
                    await composer.scroll_into_view_if_needed()
                assert await composer.is_visible()
                await page.wait_for_function("""() => {
                  const b = document.querySelector('[aria-label=追问视频内容]').getBoundingClientRect();
                  return b.top >= 0 && b.bottom <= innerHeight;
                }""")
                box = await composer.bounding_box()
                assert box and box["y"] >= 0 and box["y"] + box["height"] <= height, "切换后输入框必须在可视区域内"
                await page.screenshot(path=str(OUTPUT / f"chat-{width}.png"), full_page=True)
            CHECKS.append("1440/768/390 三尺寸截图、无横向溢出、追问入口")

            await page.set_viewport_size({"width": 390, "height": 480})
            await page.get_by_role("tab", name="总结", exact=True).click()
            await page.get_by_role("tab", name="追问", exact=True).click()
            await page.wait_for_function("""() => {
              const box = document.querySelector('[aria-label=追问视频内容]').getBoundingClientRect();
              const tab = document.querySelector('#tab-chat').getBoundingClientRect();
              return box.bottom <= innerHeight && box.top >= 0 && tab.top >= 0;
            }""")
            CHECKS.append("缩小到 390×480 的键盘视口模拟中，标签和输入区均可见")
            await page.set_viewport_size({"width": 390, "height": 844})

            followup_requests = []
            page.on("request", lambda req: followup_requests.append(req.url) if req.url.endswith("/api/followup") else None)
            await composer.fill("输入法组合中")
            await composer.evaluate("el => el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, isComposing:true}))")
            await page.wait_for_timeout(100)
            assert not followup_requests, "中文输入法组合期间 Enter 不得发送"
            await composer.press("Enter")
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
            CHECKS.append("中文输入法 Enter 与追问正常提交")

            async def failed_process(route):
                await route.fulfill(status=429, headers={"Content-Type": "application/json", "Retry-After": "1"}, body=json.dumps({"error": "测试限流，请稍后重试"}))
            await page.route("**/api/process", failed_process)
            await page.get_by_role("tab", name="总结", exact=True).click()
            await page.get_by_role("textbox", name="视频链接", exact=True).fill(VIDEO)
            await page.get_by_role("button", name="开始解析", exact=True).click()
            await page.get_by_text("测试限流，请稍后重试", exact=True).wait_for()
            assert await page.get_by_label("我的笔记", exact=True).input_value()
            await page.get_by_role("button", name="重试此链接", exact=True).wait_for(timeout=4000)
            await page.unroute("**/api/process", failed_process)
            CHECKS.append("429 Retry-After 与失败保留旧笔记")

            async def eof_process(route):
                await route.fulfill(status=200, content_type="text/event-stream", body='data: {"type":"stream_start"}\n\ndata: {"type":"stream_end"}\n\n')
            await page.route("**/api/process", eof_process)
            await page.get_by_role("button", name="重试此链接", exact=True).click()
            await page.get_by_text("连接中断，尚未取得完整结果，请重试", exact=True).wait_for()
            assert await page.get_by_label("我的笔记", exact=True).input_value()
            await page.unroute("**/api/process", eof_process)
            CHECKS.append("静默 EOF 明确失败且保留旧笔记")

            await page.evaluate("() => { window.savedIdbOpen = indexedDB.open; indexedDB.open = () => {throw new Error('test-quota')}; }")
            await page.get_by_label("我的笔记", exact=True).fill("存储失败时仍应保留的笔记")
            await page.get_by_text("本地保存失败。页面内容仍在，请导出备份后重试保存。", exact=True).wait_for()
            assert await page.get_by_role("button", name="导出 Markdown", exact=True).is_enabled()
            await page.evaluate("() => { indexedDB.open = window.savedIdbOpen; }")
            await page.get_by_role("button", name="重试保存", exact=True).click()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            CHECKS.append("IndexedDB 故障保留内存内容、可导出、可重试保存")

            # 删除服务器临时分析，保留本地笔记；重新分析必须取得新 ID。
            deleted = await page.evaluate("""async ({code,id}) => (await fetch('/api/process', {method:'DELETE', headers:{'Content-Type':'application/json','X-Access-Code':code}, body:JSON.stringify({analysisId:id, videoId:'dQw4w9WgXcQ'})})).status""", {"code": CODE, "id": initial["analysisId"]})
            assert deleted == 200
            await page.reload(wait_until="networkidle")
            await page.get_by_role("tab", name="追问", exact=True).click()
            await page.get_by_role("button", name="重新分析以继续追问", exact=True).wait_for()
            assert await page.get_by_role("textbox", name="追问视频内容", exact=True).is_disabled()
            old = (await saved_notes(page))[0]
            await page.get_by_role("button", name="重新分析以继续追问", exact=True).click()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await page.wait_for_function("document.querySelector('#personal-note')?.value === ''")
            both = await saved_notes(page)
            assert len(both) == 2 and any(n["id"] == old["id"] and n["turns"] == old["turns"] for n in both)
            fresh = next(n for n in both if n["id"] != old["id"])
            assert fresh["analysis"]["analysisId"] != initial["analysisId"] and not fresh["turns"]
            CHECKS.append("服务端失效后本地可读、追问禁用、重新分析保留旧问答并开启新上下文")

            await page.locator("summary").filter(has_text="本地笔记库").click()
            await page.get_by_role("searchbox", name="搜索笔记标题", exact=True).fill("没有这篇笔记")
            await page.get_by_text("没有匹配的笔记，换个标题关键词试试。", exact=True).wait_for()
            await page.get_by_role("searchbox", name="搜索笔记标题", exact=True).fill("隔离测试")
            await page.get_by_role("button", name="隔离测试视频 · 当前笔记", exact=False).click()
            await page.get_by_role("tab", name="追问", exact=True).click()
            await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
            CHECKS.append("笔记标题搜索与重新打开当前笔记后的在线状态")

            async def unavailable_status(route):
                await route.abort("failed")
            await page.route("**/api/analyses/**", unavailable_status)
            await page.reload(wait_until="networkidle")
            await page.get_by_role("tab", name="追问", exact=True).click()
            await page.get_by_text("暂时无法确认在线状态，笔记仍可阅读和导出。", exact=False).wait_for()
            assert await page.get_by_role("button", name="导出 Markdown", exact=True).is_enabled()
            await page.unroute("**/api/analyses/**", unavailable_status)
            await page.get_by_role("button", name="重试检查", exact=True).click()
            await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
            CHECKS.append("在线状态网络失败时可读可导出，重试后恢复追问")

            async def unauthorized_process(route):
                await route.fulfill(status=401, content_type="application/json", body=json.dumps({"error": "访问码失效"}))
            await page.route("**/api/process", unauthorized_process)
            await page.get_by_role("button", name="开始解析", exact=True).click()
            await page.get_by_placeholder("请输入访问码").wait_for()
            await page.unroute("**/api/process", unauthorized_process)
            await page.get_by_placeholder("请输入访问码").fill(CODE)
            await page.get_by_role("button", name="进入 VidSnap").click()
            await page.get_by_text("隔离测试总结", exact=True).wait_for()
            assert len(await saved_notes(page)) == 2
            CHECKS.append("处理接口 401 退回门禁，重新验证后本地笔记仍在")

            # 删除当前本地笔记不删除服务器分析或另一篇旧笔记。
            await page.locator("summary").filter(has_text="本地笔记库").click()
            row = page.get_by_role("button", name="隔离测试视频 · 当前笔记", exact=False).locator("..")
            await row.get_by_role("button", name="删除", exact=True).click()
            await row.get_by_role("button", name="确认删除", exact=True).click()
            await page.get_by_text("本地笔记已删除；服务器临时数据仍按原期限清理。", exact=True).wait_for()
            assert len(await saved_notes(page)) == 1
            status = await page.evaluate("""async ({id, code}) => (await fetch('/api/analyses/'+id, {headers:{'X-Access-Code':code}})).status""", {"id": fresh["analysis"]["analysisId"], "code": CODE})
            assert status == 200
            CHECKS.append("确认删除只删除目标本地笔记，不扩大到服务器或其他笔记")

            assert not errors, errors
            print(json.dumps({"passed": CHECKS, "runtime_errors": errors, "model_requests": "mock only"}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    asyncio.run(main())
