"""笔记备份/恢复验收，仅连接有测试标识的独立生产服务，不调用模型。"""
import asyncio
import copy
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3429"
OUTPUT = Path("tmp/notebook-browser-20261029")


def fixture():
    return {
        "id": "backup-note", "version": 1, "createdAt": 1793190000000, "updatedAt": 1793190001000, "lastViewedAt": 1793190002000,
        "personalNote": "我的实践计划：核对原文，再整理思路。",
        "analysis": {
            "analysisId": "11111111-1111-4111-8111-111111111111", "platform": "bilibili",
            "canonicalUrl": "https://www.bilibili.com/video/BV1L3tA66EKt?p=2", "expiresAt": 1000,
            "video": {"id": "BV1L3tA66EKt_p2", "title": "银行大劫案 · 学习笔记", "duration": 600, "thumbnail": "", "uploader": "隔离测试"},
            "transcriptSource": "whisper", "transcription": {"provider": "sensevoice", "timing": "estimated"},
            "vision": {"outcome": "disabled", "describedFrames": 0, "totalFrames": 0},
            "transcriptText": "核对原文，留下自己的理解。", "transcriptSegments": [{"start": 0, "end": 10, "text": "核对原文，留下自己的理解。"}],
            "result": {"overall": "测试总结：把理解整理为可复习的笔记。", "segments": [{"title": "学习方法", "start": 0, "end": 10, "points": [{"time": "00:02", "text": "对照原文"}]}]},
            "frames": [{"time": 3, "description": "测试画面依据", "src": "/api/frames?token=never-persist"}],
        },
        "turns": [{"id": 1, "question": "如何复习？", "answer": "回看原文 [00:02]", "status": "success", "purpose": "review"}],
        "excerpts": [{"id": "excerpt-1", "kind": "transcript", "text": "核对原文", "start": 0, "end": 10, "createdAt": 2}],
    }


def backup(notes):
    return {"format": "vidsnap-notebook", "version": 1, "exportedAt": 100, "notes": notes}


async def select(page, value, filename="学习备份.json"):
    await page.get_by_label("选择笔记备份文件", exact=True).set_input_files({
        "name": filename, "mimeType": "application/json", "buffer": json.dumps(value, ensure_ascii=False).encode("utf-8")})


async def read_notes(page):
    return await page.evaluate("""() => new Promise((resolve, reject) => {
      const r = indexedDB.open('vidsnap-notebook', 1);
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('notes', 'readonly');
        const get = tx.objectStore('notes').getAll(); tx.oncomplete = () => { db.close(); resolve(get.result); };
        tx.onabort = () => reject(tx.error); };
    })""")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            response = await page.goto(BASE, wait_until="networkidle")
            assert response.headers.get("x-vidsnap-test-mocks") == "1", "必须使用独立替身服务"
            button = page.get_by_role("button", name="备份全部笔记", exact=True)
            assert await button.is_disabled()
            await select(page, {"invalid": True})
            await page.get_by_text("不支持此备份格式或版本", exact=False).wait_for()
            assert await read_notes(page) == []
            await select(page, backup([fixture(), {"broken": True}]))
            await page.get_by_text("第 2 篇笔记内容不完整", exact=False).wait_for()
            assert await read_notes(page) == []
            checks.append("空库与不完整文件整份拒绝")

            await page.get_by_label("选择笔记备份文件", exact=True).set_input_files({"name": "broken.json", "mimeType": "application/json", "buffer": b"{broken"})
            await page.get_by_text("文件不是有效的 JSON 备份", exact=False).wait_for()
            await page.get_by_label("选择笔记备份文件", exact=True).set_input_files({"name": "large.json", "mimeType": "application/json", "buffer": b" " * (20 * 1024 * 1024 + 1)})
            await page.get_by_text("备份文件不能超过 20 MiB。", exact=True).wait_for()
            assert await read_notes(page) == []
            checks.append("损坏 JSON 与超大文件拒绝")

            await select(page, backup([fixture()]))
            await page.get_by_role("region", name="确认笔记导入").wait_for()
            assert await read_notes(page) == []
            await page.get_by_role("button", name="取消导入", exact=True).click()
            assert await read_notes(page) == []
            await select(page, backup([fixture()]))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入完成：新增 1 篇，跳过重复 0 篇。", exact=True).wait_for()
            assert len(await read_notes(page)) == 1
            checks.append("预览、取消与确认后写入")

            async with page.expect_download() as event:
                await button.click()
            target = OUTPUT / "notebook.json"
            await (await event.value).save_as(target)
            exported = target.read_text(encoding="utf-8")
            assert "never-persist" not in exported and "我的实践计划" in exported
            assert json.loads(exported)["notes"][0]["analysis"]["frames"][0] == {"time": 3, "description": "测试画面依据"}
            await select(page, json.loads(exported))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入完成：新增 0 篇，跳过重复 1 篇。", exact=True).wait_for()
            checks.append("真实下载、文字完整且无帧签名、重复导入跳过")

            await page.get_by_role("button", name="银行大劫案 · 学习笔记", exact=False).click()
            await page.get_by_label("我的笔记", exact=True).fill("当前浏览器编辑，不能被覆盖。")
            await page.get_by_text("已保存到当前浏览器", exact=True).wait_for()
            await page.get_by_text("本地笔记库 · 1 篇", exact=True).click()
            await select(page, backup([fixture()]))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("其中 1 篇以副本保留", exact=False).wait_for()
            notes = await read_notes(page)
            assert len(notes) == 2 and len({n["id"] for n in notes}) == 2
            assert await page.get_by_label("我的笔记", exact=True).input_value() == "当前浏览器编辑，不能被覆盖。"
            await select(page, backup([fixture()]))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入完成：新增 0 篇，跳过重复 1 篇。", exact=True).wait_for()
            assert len(await read_notes(page)) == 2
            checks.append("冲突保留副本、当前编辑不覆盖、再次导入不膨胀")

            await page.reload(wait_until="networkidle")
            assert await page.get_by_label("我的笔记", exact=True).input_value() == "当前浏览器编辑，不能被覆盖。"
            await page.get_by_text("学习辅助 · 术语解释与复习题", exact=True).click()
            assert await page.get_by_role("button", name="生成复习题", exact=True).is_disabled()
            await page.get_by_role("tab", name="原文", exact=True).click()
            await page.get_by_text("核对原文，留下自己的理解。", exact=True).wait_for()
            checks.append("刷新恢复、原文可读、过期笔记不能请求模型")

            await page.get_by_text("本地笔记库 · 2 篇", exact=True).click()
            two = [copy.deepcopy(fixture()), copy.deepcopy(fixture())]
            for i, note in enumerate(two):
                note["id"] = f"abort-{i}"
                note["personalNote"] = f"不应部分写入-{i}"
            await page.evaluate("""() => { window.originalAdd = IDBObjectStore.prototype.add; let count = 0;
              IDBObjectStore.prototype.add = function(...args) { if (++count === 2) throw new DOMException('simulated quota', 'QuotaExceededError'); return window.originalAdd.apply(this, args); }; }""")
            await select(page, backup(two))
            await page.get_by_role("button", name="确认导入", exact=True).click()
            await page.get_by_text("导入保存失败", exact=False).wait_for()
            assert len(await read_notes(page)) == 2
            await page.evaluate("() => { IDBObjectStore.prototype.add = window.originalAdd; }")
            await page.get_by_role("button", name="取消导入", exact=True).click()
            checks.append("写入中途失败整体回滚，保留原库")

            for width in [1440, 768, 390]:
                await page.set_viewport_size({"width": width, "height": 1000})
                await select(page, backup([fixture()]), "非常长的笔记备份文件名" * 10 + ".json")
                await page.get_by_role("region", name="确认笔记导入").scroll_into_view_if_needed()
                assert await page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
                await page.get_by_role("button", name="取消导入", exact=True).click()
                await select(page, backup([fixture()]))
                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(200)
                await page.screenshot(path=str(OUTPUT / f"backup-{width}.png"), full_page=True)
                await page.get_by_role("button", name="取消导入", exact=True).click()
            checks.append("桌面、平板、手机长文件名不溢出")

            other = await browser.new_context(viewport={"width": 390, "height": 844})
            other_page = await other.new_page()
            other_page.on("pageerror", lambda error: errors.append(str(error)))
            await other_page.goto(BASE, wait_until="networkidle")
            await select(other_page, json.loads(exported))
            await other_page.get_by_role("button", name="确认导入", exact=True).click()
            await other_page.get_by_text("导入完成：新增 1 篇，跳过重复 0 篇。", exact=True).wait_for()
            assert len(await read_notes(other_page)) == 1
            await other.close()
            checks.append("独立浏览器存储中恢复备份")
            assert not errors, errors
            print(json.dumps({"passed": checks, "runtime_errors": errors}, ensure_ascii=False))
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
