"""仅对带 mock 标识且设置总结延迟的隔离服务测试恢复，不调用真实模型。"""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright

spec = importlib.util.spec_from_file_location("learning_browser", Path(__file__).with_name("browser-learning.py"))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
KEY = "vidsnap-pending-process"


async def seed(page, pending):
    await page.evaluate("({key, value}) => sessionStorage.setItem(key, JSON.stringify(value))", {"key": KEY, "value": pending})


async def complete(page):
    await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
    await page.wait_for_function("sessionStorage.getItem('vidsnap-pending-process') === null")


async def main():
    output = Path("tmp/recovery-browser")
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        page = await context.new_page()
        errors, requests = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda req: requests.append(req.post_data_json) if req.url.endswith("/api/process") and req.method == "POST" else None)
        try:
            response = await page.goto(helpers.BASE)
            assert response.headers.get("x-vidsnap-test-mocks") == "1"
            await page.get_by_placeholder("请输入访问码").fill(helpers.CODE)
            await page.get_by_role("button", name="进入 VidSnap").click()
            await page.get_by_role("textbox", name="视频链接", exact=True).fill(helpers.VIDEO)
            await page.get_by_role("button", name="开始解析", exact=True).click()
            await page.wait_for_function("JSON.parse(sessionStorage.getItem('vidsnap-pending-process'))?.analysisId")
            pending = await page.evaluate("JSON.parse(sessionStorage.getItem('vidsnap-pending-process'))")
            await page.reload(wait_until="domcontentloaded")
            await page.get_by_text("隔离测试总结", exact=True).wait_for()
            await complete(page)
            assert len(requests) == 2 and not requests[0].get("resumeOnly") and requests[1]["resumeOnly"]
            note = (await helpers.saved_notes(page))[0]
            assert note["analysis"]["analysisId"] == pending["analysisId"]
            assert len(await helpers.saved_notes(page)) == 1
            checks.append("在途刷新自动加入原执行，仅一次正常提交")

            await page.get_by_label("我的笔记", exact=True).fill("恢复后仍保留的个人笔记")
            await complete(page)
            await seed(page, pending)
            await page.reload(wait_until="networkidle")
            await complete(page)
            assert (await page.get_by_label("我的笔记", exact=True).input_value()).startswith("恢复后")
            assert len(await helpers.saved_notes(page)) == 1
            checks.append("任务已完成时找回缓存，不重复笔记或清空个人笔记")

            async def eof(route):
                await route.fulfill(status=200, content_type="text/event-stream", body=f'data: {json.dumps({"type": "progress", "step": "analyzing", "percent": 80, "analysisId": pending["analysisId"]})}\n\n')
            await page.route("**/api/process", eof, times=1)
            await page.get_by_role("button", name="开始解析", exact=True).click()
            await page.get_by_role("button", name="恢复分析连接", exact=True).wait_for()
            assert await page.get_by_label("我的笔记", exact=True).is_visible()
            for width, height in [(375, 812), (844, 390)]:
                await page.set_viewport_size({"width": width, "height": height})
                await page.get_by_role("button", name="恢复分析连接", exact=True).scroll_into_view_if_needed()
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.screenshot(path=str(output / f"recovery-{width}.png"))
            await page.get_by_role("button", name="恢复分析连接", exact=True).press("Enter")
            await complete(page)
            checks.append("EOF保留原笔记、键盘恢复、375手机与横屏布局")

            await page.set_viewport_size({"width": 1440, "height": 1000})
            await seed(page, pending)
            async def limited(route):
                await route.fulfill(status=429, headers={"Retry-After": "1"}, json={"error": "恢复限流测试"})
            await page.route("**/api/process", limited, times=1)
            before = len(requests)
            await page.reload(wait_until="networkidle")
            assert await page.get_by_role("button", name="1 秒后可恢复", exact=True).is_disabled()
            await page.get_by_role("button", name="恢复分析连接", exact=True).wait_for()
            assert len(requests) == before + 1, "等待结束不得自动重复请求"
            await page.get_by_role("button", name="恢复分析连接", exact=True).click()
            await complete(page)
            checks.append("恢复429保留线索、遵循等待且不自动循环")

            await seed(page, {**pending, "url": "https://youtu.be/abcdefghijk"})
            before = len(requests)
            await page.reload(wait_until="networkidle")
            await page.get_by_text("未找到可恢复的分析", exact=False).wait_for()
            await page.wait_for_timeout(100)
            assert len(requests) == before + 1 and requests[-1]["resumeOnly"]
            assert await page.evaluate("sessionStorage.getItem('vidsnap-pending-process')") is None
            assert await page.get_by_label("我的笔记", exact=True).is_visible()
            await page.reload(wait_until="networkidle")
            assert len(requests) == before + 1
            checks.append("404清除失效线索，不新建分析、不循环，旧笔记可读")

            await seed(page, pending)
            await page.route("**/api/process", lambda route: route.fulfill(status=401, json={"error": "expired code"}), times=1)
            await page.reload(wait_until="networkidle")
            await page.get_by_placeholder("请输入访问码").wait_for()
            assert await page.evaluate("sessionStorage.getItem('vidsnap-pending-process')")
            await page.get_by_placeholder("请输入访问码").fill(helpers.CODE)
            await page.get_by_role("button", name="进入 VidSnap").click()
            await complete(page)
            checks.append("401重新验证后仍可恢复")

            blocked = await browser.new_context()
            try:
                await blocked.add_init_script("""(() => {
                  const original = Storage.prototype.setItem;
                  Storage.prototype.setItem = function(key, value) {
                    if (key === 'vidsnap-pending-process') throw new DOMException('blocked', 'SecurityError');
                    return original.call(this, key, value);
                  };
                })()""")
                blocked_page = await blocked.new_page()
                blocked_response = await blocked_page.goto(helpers.BASE)
                assert blocked_response.headers.get("x-vidsnap-test-mocks") == "1"
                await blocked_page.get_by_placeholder("请输入访问码").fill(helpers.CODE)
                await blocked_page.get_by_role("button", name="进入 VidSnap").click()
                await blocked_page.get_by_role("textbox", name="视频链接", exact=True).fill(helpers.VIDEO)
                await blocked_page.get_by_role("button", name="开始解析", exact=True).click()
                await blocked_page.get_by_text("无法保存恢复线索", exact=False).wait_for()
                await blocked_page.get_by_text("隔离测试总结", exact=True).wait_for()
                await complete(blocked_page)
                assert len(await helpers.saved_notes(blocked_page)) == 1
                checks.append("sessionStorage写失败不阻断分析与本地结果保存")
            finally:
                await blocked.close()
            assert not errors, errors
            print(json.dumps({"passed": checks, "runtime_errors": errors}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
