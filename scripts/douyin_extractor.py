"""Douyin 视频信息提取器
从 Firefox cookies 读取登录态，下载网页 HTML，解析 SSR chunk 拼接为完整 JSON
"""
import sys, json, os, re, sqlite3, urllib.request, http.cookiejar
from urllib.parse import unquote, urlparse

def get_firefox_cookies(domain_filter="douyin.com"):
    """从 Firefox 读取 cookie"""
    profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
    db_path = None
    for name in os.listdir(profile_dir):
        if name.endswith(".default-release"):
            db_path = os.path.join(profile_dir, name, "cookies.sqlite")
            if os.path.exists(db_path):
                break

    if not db_path or not os.path.exists(db_path):
        raise FileNotFoundError(f"Firefox cookie database not found in {profile_dir}")

    cj = http.cookiejar.CookieJar()
    try:
        # 先复制一份避免锁冲突
        import tempfile, shutil
        tmp = os.path.join(tempfile.gettempdir(), "cookies_copy.sqlite")
        shutil.copy2(db_path, tmp)
        conn = sqlite3.connect(tmp)
        cursor = conn.execute(
            "SELECT name, host, value, path FROM moz_cookies WHERE host LIKE ?",
            (f"%{domain_filter}%",)
        )
        cookies = cursor.fetchall()
        conn.close()
        os.unlink(tmp)
    except Exception as e:
        raise RuntimeError(f"Failed to read Firefox cookies: {e}")

    for name, host, value, path in cookies:
        c = http.cookiejar.Cookie(
            version=0, name=name, value=value,
            port=None, port_specified=False,
            domain=host, domain_specified=True, domain_initial_dot=host.startswith('.'),
            path=path, path_specified=True,
            secure=False, expires=None, discard=False,
            comment=None, comment_url=None,
            rest={}, rfc2109=False
        )
        cj.set_cookie(c)
    return cj

def fetch_page(url, cookie_jar):
    """下载页面 HTML"""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.douyin.com/",
    })
    resp = opener.open(req)
    return resp.read().decode(), resp.geturl()

def extract_video_id(url):
    """从 URL 提取视频 ID"""
    # 支持多种格式:
    # https://v.douyin.com/u6Oo6BRr_xg/ -> 解析后到 https://www.douyin.com/video/XXXX
    # https://www.douyin.com/video/XXXX
    match = re.search(r'/video/(\d+)', url)
    if match:
        return match.group(1), None
    # 短链先保持原样，下载后会重定向
    return None, url

def reconstruct_json_from_chunks(html):
    """从 SSR chunks 重构完整 JSON"""
    # 提取所有 chunk 数据
    # 格式: self.__pace_f.push([1,"URL-encoded-data"])
    pattern = r'self\.__pace_f\.push\(\[1,"((?:[^"\\]|\\.)*?)"\]'
    matches = re.findall(pattern, html)
    
    if not matches:
        return None
    
    # 最大的就是完整 app JSON
    largest_data = max(matches, key=len)
    try:
        decoded = unquote(largest_data)
        return json.loads(decoded)
    except:
        return None

def find_aweme_detail(data):
    """从 JSON 中查找 aweme_detail"""
    def dfs(obj, target, depth=0):
        if depth > 20:
            return None
        if isinstance(obj, dict):
            if target == 'aweme_detail' and 'aweme_detail' in obj:
                return obj['aweme_detail']
            if target == 'aweme' and 'aweme' in obj and isinstance(obj['aweme'], dict):
                return obj['aweme']
            if 'aweme_detail' in obj:
                return obj['aweme_detail']
            for k, v in obj.items():
                result = dfs(v, target, depth + 1)
                if result:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = dfs(item, target, depth + 1)
                if result:
                    return result
        return None
    
    return dfs(data, 'aweme_detail') or dfs(data, 'aweme')

def extract_info(aweme_detail, video_id):
    """提取关键信息"""
    result = {
        "id": video_id,
        "title": "",
        "description": "",
        "duration": 0,
        "thumbnail": "",
        "uploader": "",
        "uploader_id": "",
        "audio_url": None,
        "video_url": None,
    }
    
    result["description"] = aweme_detail.get("desc", "")
    result["title"] = result["description"][:100]  # 用描述当标题
    result["duration"] = aweme_detail.get("duration", 0)
    
    author = aweme_detail.get("author", {})
    result["uploader"] = author.get("nickname", "")
    result["uploader_id"] = author.get("uid", "")
    
    video = aweme_detail.get("video", {})
    result["duration"] = video.get("duration", result["duration"])
    
    # 封面
    cover = video.get("cover", {})
    cover_urls = cover.get("url_list", [])
    if cover_urls:
        result["thumbnail"] = cover_urls[0]
    
    # 视频播放地址（最高质量）
    play_addr = video.get("play_addr", {})
    url_list = play_addr.get("url_list", [])
    if url_list:
        result["video_url"] = url_list[0]
    
    return result

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python douyin_extractor.py <url>"}))
        sys.exit(1)

    url = sys.argv[1]

    try:
        cj = get_firefox_cookies()

        # 下载页面
        html, resolved_url = fetch_page(url, cj)
        
        # 提取视频 ID
        video_id, _ = extract_video_id(resolved_url)
        if not video_id:
            video_id = extract_video_id(url)[0]
        
        if not video_id:
            print(json.dumps({"error": f"无法提取视频 ID: {url} -> {resolved_url}"}))
            sys.exit(1)
        
        # 解析 JSON
        data = reconstruct_json_from_chunks(html)
        if not data:
            print(json.dumps({"error": "无法从页面解析 JSON 数据"}))
            sys.exit(1)
        
        # 查找 aweme_detail
        aweme = find_aweme_detail(data)
        if not aweme:
            print(json.dumps({"error": "在 JSON 中找不到视频数据"}))
            sys.exit(1)
        
        # 提取信息
        info = extract_info(aweme, video_id)
        print(json.dumps(info, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()