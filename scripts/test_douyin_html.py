"""测试从 Douyin 网页 HTML 中提取视频信息"""
import sqlite3, os, json, urllib.request, http.cookiejar, re

# 1. 从 Firefox 读取 cookie
profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
for name in os.listdir(profile_dir):
    if name.endswith(".default-release"):
        db_path = os.path.join(profile_dir, name, "cookies.sqlite")
        break

conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
cursor = conn.execute(
    "SELECT name, host, value, path FROM moz_cookies WHERE host LIKE '%douyin.com'"
)
cookies = cursor.fetchall()
conn.close()

# 2. 构建 cookie jar
cj = http.cookiejar.CookieJar()
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

# 3. 下载网页
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    "https://www.douyin.com/video/7661190102001133730",
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    }
)
resp = opener.open(req)
html = resp.read().decode()
print(f"HTML length: {len(html)}")

# 4. 查找嵌入的 JSON 数据
# Douyin 页面通常在 <script id="RENDER_DATA"> 或 window.__INITIAL_STATE__ 中
patterns = [
    r'<script id="RENDER_DATA"[^>]*>(.*?)</script>',
    r'window\.__INITIAL_STATE__\s*=\s*({.*?});',
    r'"aweme_detail":\s*({.*?})',
    r'"videoInfo":\s*({.*?})',
    r'<script id="SSR_HYDRATED_DATA"[^>]*>(.*?)</script>',
    r'<script[^>]*type="application/json"[^>]*>(.*?)</script>',
]

for pattern in patterns:
    match = re.search(pattern, html, re.DOTALL)
    if match:
        data = match.group(1)
        print(f"\nFound match for pattern: {pattern[:50]}...")
        print(f"Data length: {len(data)}")
        print(f"First 200 chars: {data[:200]}")
        try:
            # RENDER_DATA is URL-encoded JSON
            from urllib.parse import unquote
            decoded = unquote(data)
            parsed = json.loads(decoded)
            print(f"Parsed successfully! Keys: {list(parsed.keys())[:10]}")
        except:
            print("Could not parse as JSON")

# Also search for common patterns
if 'RENDER_DATA' in html:
    print("\nRENDER_DATA found in HTML")
if '__INITIAL_STATE__' in html:
    print("__INITIAL_STATE__ found in HTML")
if 'aweme' in html.lower():
    print("'aweme' found in HTML")