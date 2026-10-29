"""学习进度/复习验收；要求显式替身隔离服务，不调用真实模型。"""
import asyncio
import copy
import importlib.util
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load("notebook_helpers", "browser-notebook-backup.py")
learning = load("learning_helpers", "browser-learning.py")
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3430"
OUTPUT = Path("tmp/learning-progress-browser-20261029")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, reduced_motion="reduce")
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            response = await page.goto(BASE, wait_until="networkidle")
            assert response.headers.get("x-vidsnap-test-mocks") == "1", "必须使用隔离测试服务"
            note = backup.fixture()
            note["analysis"]["result"]["segments"].append({"title": "梳理方法与实践", "start": 10, "end": 20, "points": []})
            other = copy.deepcopy(note)
            other["id"] = "second-note"
            other["analysis"]["analysisId"] = "22222222-2222-4222-8222-222222222222"
            other["analysis"]["video"]["title"] = "尚未学习的视频"
            await backup.select(page, backup.backup([note, other]))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入完成：新增 2 篇，跳过重复 0 篇。", exact=True).wait_for()
            await page.get_by_role("button", name="银行大劫案 · 学习笔记", exact=False).click()
            panel = page.get_by_role("region", name="学习进度与复习", exact=True)
            await panel.get_by_text("已学 0/2 章节 · 待学习", exact=True).wait_for()
            await panel.get_by_text("逐章标记学习进度", exact=True).click()
            boxes = panel.get_by_role("checkbox")
            await boxes.nth(0).check()
            await panel.get_by_text("已学 1/2 章节 · 学习中", exact=True).wait_for()
            await boxes.nth(1).check()
            await panel.get_by_text("已学 2/2 章节 · 已学完", exact=True).wait_for()
            await boxes.nth(1).uncheck()
            await panel.get_by_text("已学 1/2 章节 · 学习中", exact=True).wait_for()
            await boxes.nth(1).focus()
            await boxes.nth(1).press("Space")
            await panel.get_by_text("已学 2/2 章节 · 已学完", exact=True).wait_for()
            checks.append("旧笔记兼容、勾选/取消/键盘标记及状态变化")

            await panel.get_by_role("button", name="记录一次复习", exact=True).click()
            await panel.get_by_role("button", name="记录一次复习", exact=True).click()
            await panel.get_by_text("已记录复习 2 次", exact=False).wait_for()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            notes = await backup.read_notes(page)
            saved = next(n for n in notes if n["id"] == note["id"])
            assert saved["learning"]["completedChapters"] == [0, 1]
            assert saved["learning"]["reviewCount"] == 2 and saved["learning"]["lastReviewedAt"] > 0
            await page.reload(wait_until="networkidle")
            await panel.get_by_text("已学 2/2 章节 · 已学完", exact=True).wait_for()
            await panel.get_by_text("已记录复习 2 次", exact=False).wait_for()
            await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()
            assert await page.get_by_role("button", name="生成复习题", exact=True).is_disabled()
            assert await panel.get_by_role("button", name="记录一次复习", exact=True).is_enabled()
            await panel.get_by_text("逐章标记学习进度", exact=True).click()
            await panel.get_by_role("button", name="查看章节原文：学习方法", exact=True).click()
            await page.get_by_text("正在核对 00:00（估算时间）", exact=True).wait_for()
            checks.append("手动复习次数/日期持久化、过期可更新和章节原文定位")

            await page.get_by_text("本地笔记库 · 2 篇", exact=True).click()
            library = page.locator("details.study-panel").first
            status = page.get_by_label("筛选学习状态", exact=True)
            await status.select_option("completed")
            assert await library.get_by_role("button", name="银行大劫案", exact=False).count() == 1
            assert await library.get_by_role("button", name="尚未学习的视频", exact=False).count() == 0
            await status.select_option("unstarted")
            assert await library.get_by_role("button", name="尚未学习的视频", exact=False).count() == 1
            await status.select_option("in_progress")
            await library.get_by_text("没有匹配的笔记", exact=False).wait_for()
            checks.append("三种学习状态筛选和空状态")

            async with page.expect_download() as event:
                await page.get_by_role("button", name="备份全部笔记", exact=True).click()
            target = OUTPUT / "progress-notebook.json"
            await (await event.value).save_as(target)
            exported = json.loads(target.read_text(encoding="utf-8"))
            assert len(exported["notes"]) == 2, "筛选不应影响全库备份"
            assert next(n for n in exported["notes"] if n["id"] == note["id"])["learning"] == saved["learning"]
            async with page.expect_download() as event:
                await page.get_by_role("button", name="导出 Markdown", exact=True).click()
            target = OUTPUT / "progress.md"
            await (await event.value).save_as(target)
            assert all(text in target.read_text(encoding="utf-8") for text in ["## 学习记录", "已学 2/2 章节", "复习次数：2", "学习标记：已学"])
            other_context = await browser.new_context()
            other_page = await other_context.new_page()
            await other_page.goto(BASE, wait_until="networkidle")
            await backup.select(other_page, exported)
            await other_page.get_by_role("button", name="确认导入", exact=True).click()
            await other_page.get_by_text("导入完成：新增 2 篇，跳过重复 0 篇。", exact=True).wait_for()
            restored = next(n for n in await backup.read_notes(other_page) if n["id"] == note["id"])
            assert restored["learning"] == saved["learning"]
            await other_context.close()
            checks.append("筛选下全库备份、Markdown记录及跨浏览器恢复进度")

            broken = copy.deepcopy(note)
            broken["learning"] = {"completedChapters": [99], "reviewCount": 0}
            await backup.select(page, backup.backup([broken]))
            await page.get_by_text("第 1 篇笔记内容不完整", exact=False).wait_for()
            assert len(await backup.read_notes(page)) == 2
            checks.append("越界进度备份整份拒绝")

            await page.evaluate("""() => { window.originalPut = IDBObjectStore.prototype.put;
              IDBObjectStore.prototype.put = function() { throw new DOMException('quota', 'QuotaExceededError'); }; }""")
            await boxes.nth(1).uncheck()
            await page.get_by_text("本地保存失败。页面内容仍在", exact=False).wait_for()
            assert next(n for n in await backup.read_notes(page) if n["id"] == note["id"])["learning"]["completedChapters"] == [0, 1]
            await panel.get_by_text("已学 1/2 章节 · 学习中", exact=True).wait_for()
            await page.evaluate("() => { IDBObjectStore.prototype.put = window.originalPut; }")
            await page.get_by_role("button", name="重试保存", exact=True).click()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            assert next(n for n in await backup.read_notes(page) if n["id"] == note["id"])["learning"]["completedChapters"] == [0]
            checks.append("保存失败保留内存进度，恢复存储后可重试")

            await status.select_option("all")
            await backup.select(page, backup.backup([note]))
            await page.get_by_role("button", name="取消导入", exact=True).click()
            for width in [1440, 768, 390]:
                await page.set_viewport_size({"width": width, "height": 1000})
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.evaluate("window.scrollTo(0, 0)")
                await page.screenshot(path=str(OUTPUT / f"progress-{width}.png"), full_page=True)
            checks.append("桌面/平板/手机进度及筛选无横向溢出")

            fresh = await learning.analyze(page)
            fresh_notes = await backup.read_notes(page)
            assert len(fresh_notes) == 3
            fresh_note = next(n for n in fresh_notes if n["analysis"]["analysisId"] == fresh["analysisId"])
            assert not fresh_note.get("learning"), "新分析不继承旧进度"
            panel = page.get_by_role("region", name="学习进度与复习", exact=True)
            if not await panel.get_by_role("checkbox").first.is_visible():
                await panel.get_by_text("逐章标记学习进度", exact=True).click()
            await panel.get_by_role("checkbox").first.check()
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await learning.analyze(page)
            after_cache = next(n for n in await backup.read_notes(page) if n["analysis"]["analysisId"] == fresh["analysisId"])
            assert after_cache["learning"]["completedChapters"] == [0]
            assert len(await backup.read_notes(page)) == 3
            checks.append("新分析从头学习，同分析缓存保留进度")
            assert not errors, errors
            print(json.dumps({"passed": checks, "runtime_errors": errors}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
