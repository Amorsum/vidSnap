"""用 Playwright 提取抖音视频信息（自动处理 X-Bogus 签名）"""
import sys, json, os, re, asyncio, sqlite3, shutil, tempfile
from playwright.async_api import async_playwright

def get_douyin_cookies():
    """从 Firefox 读取抖音 cookies"""
    profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
    for name in os.listdir(profile_dir):
        if name.endswith(".default-release"):
            db_path = os.path.join(profile_dir, name, "cookies.sqlite")
            break

    tmp = os.path.join(tempfile.gettempdir(), "cookies_pw.sqlite")
    shutil.copy2(db_path, tmp)
    conn = sqlite3.connect(tmp)
    cursor = conn.execute(
        "SELECT name, host, value, path FROM moz_cookies WHERE host LIKE '%douyin%'"
    )
    cookies = cursor.fetchall()
    conn.close()
    os.unlink(tmp)

    result = []
    for name, host, value, path in cookies:
        result.append({
            "name": name,
            "value": value,
            "domain": host,
            "path": path,
        })
    return result

async def extract_douyin_info(url):
    """用 Playwright 加载抖音页面，拦截 API 响应获取视频数据"""
    cookies = get_douyin_cookies()
    print(f"Loaded {len(cookies)} Douyin cookies", file=sys.stderr)

    video_data = None
    resolved_url = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            channel="chrome",
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        )
        await context.add_cookies(cookies)

        page = await context.new_page()

        # 拦截 API 响应
        async def handle_response(response):
            nonlocal video_data
            if "aweme/v1/web/aweme/detail" in response.url and response.status == 200:
                try:
                    body = await response.json()
                    if body and "aweme_detail" in body:
                        video_data = body
                        print(f"Captured API response!", file=sys.stderr)
                except:
                    pass

        page.on("response", handle_response)

        # 访问抖音页面
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        resolved_url = page.url  # 获取重定向后的真实 URL
        
        # 等待 API 响应（最多等 15 秒）
        for _ in range(30):
            if video_data:
                break
            await asyncio.sleep(0.5)

        await browser.close()

    return video_data, resolved_url

def parse_video_info(data, video_id):
    """解析 API 返回的视频数据"""
    aweme = data.get("aweme_detail", {})
    
    result = {
        "id": video_id,
        "title": aweme.get("desc", ""),
        "duration": aweme.get("duration", 0),
        "thumbnail": "",
        "uploader": "",
        "video_url": None,
        "audio_url": None,
    }

    author = aweme.get("author", {})
    result["uploader"] = author.get("nickname", "")

    video = aweme.get("video", {})
    result["duration"] = video.get("duration", result["duration"])

    # 封面
    cover = video.get("cover", {})
    cover_urls = cover.get("url_list", [])
    if cover_urls:
        result["thumbnail"] = cover_urls[0]

    # 视频播放地址
    play_addr = video.get("play_addr", {})
    url_list = play_addr.get("url_list", [])
    if url_list:
        result["video_url"] = url_list[0]

    return result

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python douyin_playwright.py <url>"}))
        sys.exit(1)

    url = sys.argv[1]

    try:
        data, resolved_url = asyncio.run(extract_douyin_info(url))

        if not data:
            print(json.dumps({"error": "未能获取视频数据，请确认已登录抖音"}))
            sys.exit(1)

        # 提取 video_id
        match = re.search(r'/video/(\d+)', resolved_url)
        video_id = match.group(1) if match else "unknown"

        info = parse_video_info(data, video_id)
        print(json.dumps(info, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()