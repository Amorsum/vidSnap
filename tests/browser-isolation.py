"""隔离生产副本的浏览器回归；服务必须显式加载 mock-upstream.mjs。"""
import asyncio
import json
import sys
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3418"
CODE = "isolation-test-only"
VIDEO = "https://youtu.be/dQw4w9WgXcQ"
RESOURCES = []


async def api(page, route, body=None, method="POST"):
    return await page.evaluate("""async ({route, body, method, code}) => {
        const response = await fetch(route, {
            method, headers: {'Content-Type': 'application/json', 'X-Access-Code': code},
            ...(body === null ? {} : {body: JSON.stringify(body)})
        });
        return {status: response.status, data: await response.json()};
    }""", {"route": route, "body": body, "method": method, "code": CODE})


async def workspace(browser, viewport, question):
    context = await browser.new_context(viewport=viewport)
    page = await context.new_page()
    errors = []
    external_fonts = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external_fonts.append(request.url) if "fonts.googleapis.com" in request.url or "fonts.gstatic.com" in request.url else None)
    initial_response = await page.goto(BASE, wait_until="networkidle")
    assert initial_response and initial_response.headers.get("x-vidsnap-test-mocks") == "1", "只允许对显式加载测试替身的隔离服务执行"
    font_state = await page.evaluate("""async () => {
        const text = 'VidSnap 012 Ā Ạ Ж Ѡ ⎸';
        const sans = await document.fonts.load('16px Geist', text);
        const mono = await document.fonts.load('16px "Geist Mono"', text);
        await document.fonts.ready;
        return {sans: sans.filter(font => font.status === 'loaded').length,
            mono: mono.filter(font => font.status === 'loaded').length};
    }""")
    assert font_state["sans"] == 5 and font_state["mono"] == 6, f"字体子集未全部解码：{font_state}"
    await page.get_by_placeholder("请输入访问码").fill("wrong-test-code")
    async with page.expect_response(lambda response: response.url.endswith("/api/verify")) as rejected:
        await page.get_by_role("button", name="进入 VidSnap").click()
    assert (await rejected.value).status == 401
    await page.get_by_text("访问码错误", exact=True).wait_for(state="visible")
    await page.get_by_placeholder("请输入访问码").fill(CODE)
    async with page.expect_response(lambda response: response.url.endswith("/api/verify")) as verification:
        await page.get_by_role("button", name="进入 VidSnap").click()
    assert (await verification.value).status == 200
    await page.get_by_role("textbox", name="视频链接").wait_for(state="visible")
    cookies = await context.cookies()
    session = next((cookie for cookie in cookies if cookie["name"] == "vidsnap-session"), None)
    assert session and session["httpOnly"] and session["sameSite"] == "Lax", "Cookie 未正确落入浏览器"
    assert "vidsnap-session" not in await page.evaluate("document.cookie"), "会话凭据不应对脚本可见"
    verification_started = asyncio.Event()
    release_verification = asyncio.Event()

    async def hold_verification(route):
        verification_started.set()
        await release_verification.wait()
        await route.continue_()

    await page.route("**/api/verify", hold_verification)
    reload_task = asyncio.create_task(page.reload(wait_until="networkidle"))
    try:
        await asyncio.wait_for(verification_started.wait(), timeout=10)
        await page.get_by_role("button", name="正在验证...").wait_for(state="visible", timeout=5000)
        assert await page.get_by_role("button", name="正在验证...").is_disabled(), "签发期间不能重复验证"
        assert await page.get_by_role("textbox", name="视频链接").count() == 0, "Cookie 签发前不能开放处理"
    finally:
        release_verification.set()
    await reload_task
    await page.unroute("**/api/verify", hold_verification)
    await page.get_by_role("textbox", name="视频链接").wait_for(state="visible")
    after_reload = next(cookie for cookie in await context.cookies() if cookie["name"] == "vidsnap-session")
    assert after_reload["value"] == session["value"], "已存访问码校验应复用会话"
    await page.get_by_role("textbox", name="视频链接").fill(VIDEO)
    async with page.expect_response(lambda response: response.url.endswith("/api/process")) as processing:
        await page.get_by_role("button", name="开始解析").click()
    response = await processing.value
    assert response.status == 200
    await page.get_by_text("已保存到当前浏览器", exact=True).wait_for(state="visible")
    # 客户端收到合法 result 后主动关闭 reader；从已提交的本地快照确认结果。
    result = await page.evaluate("""() => new Promise((resolve, reject) => {
        const request = indexedDB.open('vidsnap-notebook', 1);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('notes', 'readonly');
            const read = tx.objectStore('notes').getAll();
            tx.oncomplete = () => { db.close(); resolve(read.result.sort((a,b) => b.lastViewedAt-a.lastViewedAt)[0]?.analysis); };
            tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    })""")
    assert result and result["analysisId"], "SSE 未正常完成"
    RESOURCES.append((page, result))
    await page.get_by_text("隔离测试总结", exact=True).wait_for(state="visible")
    await page.wait_for_function("""() => {
        const images = [...document.querySelectorAll('img[src^="/api/frames"]')];
        return images.length === 3 && images.every(image => image.complete && image.naturalWidth > 0);
    }""")
    result["frames"] = await page.locator('img[src^="/api/frames"]').evaluate_all("images => images.map(image => ({src:image.getAttribute('src')}))")
    await page.get_by_role("tab", name="追问", exact=True).click()
    await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
    await page.get_by_role("textbox", name="追问视频内容").fill(question)
    async with page.expect_response(lambda response: response.url.endswith("/api/followup")) as asking:
        await page.get_by_role("textbox", name="追问视频内容").press("Enter")
    answer = await asking.value
    data = await answer.json()
    assert answer.status == 200 and data["analysisId"] == result["analysisId"], "追问未使用对应分析"
    assert answer.request.post_data_json["analysisId"] == result["analysisId"]
    await page.get_by_text("模拟追问回答", exact=False).last.wait_for(state="visible")
    assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "页面横向溢出"
    assert not errors, f"浏览器运行异常：{errors}"
    assert not external_fonts, "本地字体不应请求 Google Fonts"
    return context, page, result, data


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel="chrome", headless=True)
        try:
            first_context, first, a, a_answer = await workspace(browser, {"width": 1440, "height": 1000}, "甲的独立问题")
            second_context, second, b, b_answer = await workspace(browser, {"width": 390, "height": 844}, "乙的独立问题")
            assert a["analysisId"] != b["analysisId"]
            assert "甲的独立问题" not in b_answer["answer"]
            assert "乙的独立问题" not in a_answer["answer"]
            body = {"videoId": a["video"]["id"], "analysisId": a["analysisId"]}
            assert (await api(second, "/api/followup", {**body, "question": "越权问题"}))["status"] == 404
            assert (await api(second, "/api/process", body, "DELETE"))["status"] == 404
            frame_url = a["frames"][0]["src"]
            assert await second.evaluate("async url => (await fetch(url)).status", frame_url) == 404
            assert (await api(first, "/api/process", body, "DELETE"))["status"] == 200
            assert await first.evaluate("async url => (await fetch(url)).status", frame_url) == 404
            assert (await api(second, "/api/followup", {"videoId": b["video"]["id"], "analysisId": b["analysisId"], "question": "删除甲后乙继续追问"}))["status"] == 200
            assert (await api(second, "/api/process", {"videoId": b["video"]["id"], "analysisId": b["analysisId"]}, "DELETE"))["status"] == 200
            await first_context.close()
            await second_context.close()
            print(json.dumps({"desktop": "passed", "mobile": "passed", "local_font_subsets": 11, "external_font_requests": 0, "gate_invalid_code": "rejected", "stored_code_reload": "passed", "cookie_http_only": "passed", "frames": "passed", "followup": "passed", "cross_session_access": "rejected", "owned_delete": "passed", "console_runtime_errors": 0}))
        finally:
            for page, result in RESOURCES:
                if not page.is_closed():
                    await api(page, "/api/process", {"videoId": result["video"]["id"], "analysisId": result["analysisId"]}, "DELETE")
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    asyncio.run(main())
