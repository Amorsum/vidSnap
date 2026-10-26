"""学习辅助浏览器回归；仅连接带测试标识的隔离服务。"""
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright

spec = importlib.util.spec_from_file_location("learning_browser", Path(__file__).with_name("browser-learning.py"))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)


async def main():
    output = Path("tmp/study-browser")
    output.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = await context.new_page()
        errors, requests = [], []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            response = await page.goto(helpers.BASE)
            assert response.headers.get("x-vidsnap-test-mocks") == "1"
            await page.get_by_placeholder("请输入访问码").fill(helpers.CODE)
            await page.get_by_role("button", name="进入 VidSnap").click()
            await helpers.analyze(page)

            async def answer(route):
                question = route.request.post_data_json["question"]
                requests.append(question)
                text = "第一题：如何使用这一方法？ [00:01]" if "此轮只给题目" in question else "测试参考解释与依据 [00:01]"
                await route.fulfill(json={"success": True, "answer": text, "toolsUsed": []})

            await page.route("**/api/followup", answer)
            await page.get_by_role("button", name="摘录要点", exact=True).first.click()
            await page.get_by_role("button", name="已摘录", exact=True).first.wait_for()
            await page.get_by_role("tab", name="原文", exact=True).click()
            await page.get_by_role("button", name="摘录原文", exact=True).first.click()
            await page.get_by_role("button", name="已摘录", exact=True).first.wait_for()
            await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()
            term = page.get_by_label("想理解的术语", exact=True)
            await term.fill("检索增强生成")
            await term.evaluate("el => el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, isComposing:true}))")
            assert not requests
            await term.press("Enter")
            await page.get_by_role("button", name="摘录回答", exact=True).wait_for()
            assert "检索增强生成" in requests[0]
            await page.get_by_role("button", name="摘录回答", exact=True).click()
            await page.get_by_role("button", name="生成复习题", exact=True).click()
            answers = page.get_by_role("button", name="查看参考答案", exact=True)
            await answers.wait_for()
            assert len(requests) == 2
            await answers.click()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await page.wait_for_function("!document.querySelector('[aria-label=追问视频内容]').disabled")
            assert len(requests) == 3 and "第一题：如何使用" in requests[2]
            notes = await helpers.saved_notes(page)
            assert len(notes[0]["excerpts"]) == 3
            assert [t["purpose"] for t in notes[0]["turns"]] == ["term", "review", "review_answers"]

            await page.reload(wait_until="networkidle")
            await page.get_by_role("heading", name="重点摘录 · 3 条", exact=True).wait_for()
            async with page.expect_download() as download:
                await page.get_by_role("button", name="导出 Markdown", exact=True).click()
            target = output / "study-note.md"
            await (await download.value).save_as(target)
            exported = target.read_text(encoding="utf-8")
            assert all(s in exported for s in ["重点摘录", "字幕原文", "总结要点", "AI 问答", "第一题"])
            assert "token=" not in exported
            await page.get_by_role("button", name="查看摘录原文 00:00", exact=True).click()
            await page.get_by_text("正在核对 00:00", exact=True).wait_for()
            await page.get_by_role("tab", name="总结", exact=True).click()
            await page.get_by_role("button", name="移除摘录：", exact=False).first.click()
            await page.get_by_role("heading", name="重点摘录 · 2 条", exact=True).wait_for()
            for width in [1440, 390]:
                await page.set_viewport_size({"width": width, "height": 900})
                await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()
                await page.get_by_label("想理解的术语", exact=True).scroll_into_view_if_needed()
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.screenshot(path=str(output / f"study-{width}.png"))
                await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()

            await page.route("**/api/analyses/*", lambda route: route.fulfill(status=404, json={"error": "expired"}))
            await page.reload(wait_until="networkidle")
            await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()
            assert await page.get_by_role("button", name="生成复习题", exact=True).is_disabled()
            await page.get_by_role("tab", name="追问", exact=True).click()
            assert await page.get_by_role("button", name="查看参考答案", exact=True).is_disabled()
            assert len((await helpers.saved_notes(page))[0]["excerpts"]) == 2
            assert not errors, errors
            print(json.dumps({"passed": ["三种来源摘录与去重", "中文输入法与术语解释", "题目和参考答案分次请求", "用途与摘录刷新恢复", "Markdown 下载", "摘录定位与删除", "桌面手机无溢出", "过期后可读但禁止生成"], "runtime_errors": errors}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
