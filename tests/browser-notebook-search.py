"""本地笔记全文搜索验收；仅在有测试标识的隔离生产服务运行。"""
import asyncio
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

spec = importlib.util.spec_from_file_location("backup_helpers", Path(__file__).with_name("browser-notebook-backup.py"))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3431"
OUTPUT = Path("tmp/notebook-search-browser-20261029")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks, errors, paid_requests = [], [], []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, reduced_motion="reduce")
        page = await context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("request", lambda r: paid_requests.append(r.url) if r.method == "POST" and (r.url.endswith("/api/process") or r.url.endswith("/api/followup")) else None)
        try:
            response = await page.goto(BASE, wait_until="networkidle")
            assert response.headers.get("x-vidsnap-test-mocks") == "1", "必须使用隔离服务"
            note = helpers.fixture()
            note["analysis"]["video"]["title"] = "前端缓存与性能：从原理到实践"
            note["personalNote"] = "个人诀窍：解释 RaG 缓存，遇到 a+b? 按字面搜索。<img src=x onerror=window.__notebookExecuted=1>"
            note["excerpts"][0]["text"] = "摘录卡片：缓存应核对来源"
            note["excerpts"][0]["start"] = 3
            note["analysis"]["result"]["overall"] = "总结诀窍：验证过程需要证据"
            note["analysis"]["result"]["segments"][0]["points"][0]["text"] = "要点专用：处理命中之后的工作"
            note["analysis"]["transcriptSegments"] = [{"start": 0, "end": 10, "text": "开头依据"}, {"start": 42, "end": 50, "text": "字幕定位词：先核对缓存边界，再确认依据。"}]
            note["analysis"]["transcriptText"] = "开头依据。字幕定位词：先核对缓存边界，再确认依据。"
            note["turns"] = [{"id": 11, "question": "问句专用：如何验证缓存？", "answer": "答句专用：用恢复测试确认 [00:42]", "status": "success"}]
            note["turns"] += [{"id": i, "question": f"其他问题{i}", "answer": f"其他回答{i}", "status": "success"} for i in range(12, 25)]
            other = copy.deepcopy(note)
            other["id"] = "other-note"
            other["analysis"]["analysisId"] = "22222222-2222-4222-8222-222222222222"
            other["analysis"]["video"]["title"] = "后端缓存学习"
            other["personalNote"] = "另一篇也保存了字幕定位词，供状态筛选验收。"
            other["turns"] = []
            other["excerpts"] = []
            other["analysis"]["transcriptSegments"] = []
            other["analysis"]["transcriptText"] = "后端字幕"
            other["analysis"]["result"]["overall"] = "后端内容"
            other["analysis"]["result"]["segments"][0]["points"] = []
            other["learning"] = {"completedChapters": [0], "reviewCount": 0}
            legacy = copy.deepcopy(other)
            legacy["id"] = "legacy-note"
            legacy["analysis"]["analysisId"] = "33333333-3333-4333-8333-333333333333"
            legacy["analysis"]["video"]["title"] = "旧版笔记"
            legacy["personalNote"] = ""
            legacy["analysis"]["transcriptText"] = "旧全文专用：没有时间分段也可以核对这段保存的文字。"
            del legacy["learning"]
            await helpers.select(page, helpers.backup([note, other, legacy]))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入完成：新增 3 篇，跳过重复 0 篇。", exact=True).wait_for()
            library = page.locator("details.study-panel").first
            search = page.get_by_role("searchbox", name="搜索笔记内容", exact=True)

            async def find(query, kind=None):
                if not await search.is_visible():
                    await library.locator("summary").first.click()
                await search.fill(query)
                if kind:
                    hit = library.get_by_role("button", name=f"打开命中：{kind} · {note['analysis']['video']['title']}", exact=False).first
                    await hit.wait_for()
                    return hit

            for query, kind, tab in [("从原理到实践", "视频标题", "总结"), ("个人诀窍", "个人笔记", "总结"),
                ("摘录卡片", "重点摘录", "原文"), ("问句专用", "历史问题", "追问"),
                ("答句专用", "历史回答", "追问"), ("总结诀窍", "视频总结", "总结")]:
                hit = await find(query, kind)
                await hit.click()
                assert await page.get_by_role("tab", name=tab, exact=True).get_attribute("aria-selected") == "true"
                if kind == "个人笔记":
                    assert await page.evaluate("document.activeElement.id") == "personal-note"
                    assert await page.evaluate("(() => { const e = document.getElementById('personal-note'); return e.value.slice(e.selectionStart, e.selectionEnd); })()") == query
                if kind in ["历史问题", "历史回答"]:
                    assert await page.evaluate("document.activeElement.id") == "study-turn-11"
                    assert await page.locator("#study-turn-11").is_visible()
            hit = await find("字幕定位词", "字幕原文")
            await hit.click()
            await page.get_by_text("正在核对 00:42（估算时间）", exact=True).wait_for()
            checks.append("七类内容命中、个人笔记选中、早期对话聚焦及字幕时间定位")

            await find("字幕定位词")
            await page.get_by_text("找到 2 篇笔记，每篇最多显示 3 处命中。", exact=True).wait_for()
            status = page.get_by_label("筛选学习状态", exact=True)
            await status.select_option("completed")
            await page.get_by_text("找到 1 篇笔记，每篇最多显示 3 处命中。", exact=True).wait_for()
            assert await library.get_by_role("button", name=re.compile("^后端缓存学习")).count() == 1
            async with page.expect_download() as event:
                await page.get_by_role("button", name="备份全部笔记", exact=True).click()
            target = OUTPUT / "search-backup.json"
            await (await event.value).save_as(target)
            assert len(json.loads(target.read_text(encoding="utf-8"))["notes"]) == 3
            await status.select_option("all")
            checks.append("状态与全文组合筛选、正确篇数及搜索不限制全库备份")

            for query in ["rag", "a+b?", "onerror"]:
                hit = await find(query, "个人笔记")
                assert await hit.locator("mark").count() == 1
                assert await library.locator("img").count() == 0
            assert await page.evaluate("window.__notebookExecuted === undefined")
            await find("r.g")
            await library.get_by_text("没有匹配的笔记", exact=False).wait_for()
            assert await search.get_attribute("maxlength") == "200"
            await library.get_by_role("button", name="清空搜索", exact=True).click()
            legacy_row = library.get_by_role("button", name=re.compile("^旧版笔记"))
            await legacy_row.wait_for()
            assert await legacy_row.count() == 1
            checks.append("忽略大小写、特殊字符字面匹配、HTML转义、清空与无结果")

            hit = await find("个人诀窍", "个人笔记")
            await hit.click()
            await page.get_by_label("我的笔记", exact=True).fill("个人诀窍：用 RaG 理解缓存机制，结合原文检查可靠依据。 实时新词")
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await find("实时新词", "个人笔记")
            checks.append("编辑后无需重建索引即搜索新内容")

            await find("旧全文专用")
            await library.get_by_role("button", name="打开命中：字幕原文 · 旧版笔记", exact=False).click()
            await page.get_by_text("此笔记仅保留字幕全文，没有分段时间，无法按秒定位。", exact=True).wait_for()
            await page.get_by_label("字幕列表", exact=True).get_by_text(legacy["analysis"]["transcriptText"], exact=True).wait_for()
            checks.append("无分段旧全文检索与阅读，不伪造时间")

            await page.route("**/api/analyses/*", lambda route: route.abort())
            await find("字幕定位词", "字幕原文")
            await library.get_by_role("button", name="打开命中：字幕原文", exact=False).first.click()
            await page.get_by_text("正在核对 00:42（估算时间）", exact=True).wait_for()
            checks.append("在线状态API不可用时仍能搜索和核对本地正文")

            await find("缓存")
            for width in [1440, 768, 390]:
                await page.set_viewport_size({"width": width, "height": 1000})
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.evaluate("window.scrollTo(0, 0)")
                await page.screenshot(path=str(OUTPUT / f"search-{width}.png"), full_page=True)
            checks.append("桌面/平板/手机命中片段无横向溢出")

            await find("个人诀窍", "个人笔记")
            await library.get_by_role("button", name="删除", exact=True).click()
            await library.get_by_role("button", name="确认删除", exact=True).click()
            await page.get_by_text("本地笔记已删除", exact=False).wait_for()
            await library.get_by_text("没有匹配的笔记", exact=False).wait_for()
            assert len(await helpers.read_notes(page)) == 2
            checks.append("删除后命中即时失效")
            assert not errors, errors
            assert not paid_requests, paid_requests
            print(json.dumps({"passed": checks, "runtime_errors": errors}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
