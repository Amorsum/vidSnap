"""调试：下载 Douyin 页面 HTML 并保存"""
import sys, os, shutil, sqlite3, urllib.request, http.cookiejar, tempfile

profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
for name in os.listdir(profile_dir):
    if name.endswith(".default-release"):
        db_path = os.path.join(profile_dir, name, "cookies.sqlite")
        break

tmp = os.path.join(tempfile.gettempdir(), "cookies_debug.sqlite")
shutil.copy2(db_path, tmp)
conn = sqlite3.connect(tmp)
cursor = conn.execute(
    "SELECT name, host, value, path FROM moz_cookies WHERE host LIKE '%douyin%'"
)
cookies = cursor.fetchall()
conn.close()
os.unlink(tmp)

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

# 先解析短链接
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(cj),
    urllib.request.HTTPRedirectHandler()
)
req = urllib.request.Request(sys.argv[1], headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
})
resp = opener.open(req)
resolved_url = resp.geturl()
print(f"Resolved URL: {resolved_url}")

# 下载视频页面
opener2 = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req2 = urllib.request.Request(resolved_url, headers={
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Referer": "https://www.douyin.com/",
})
resp2 = opener2.open(req2)
html = resp2.read().decode()

# 保存
with open("tmp/douyin_debug.html", "w", encoding="utf-8") as f:
    f.write(html)

print(f"HTML length: {len(html)}")
print(f"Has RENDER_DATA: {'RENDER_DATA' in html}")
print(f"Has __INITIAL_STATE__: {'__INITIAL_STATE__' in html}")
print(f"Has SSR_HYDRATED_DATA: {'SSR_HYDRATED_DATA' in html}")
print(f"Has aweme: {'aweme' in html.lower()}")
print(f"Has video: {'video' in html.lower()}")

# 查找所有 script 标签的 id
import re
scripts = re.findall(r'<script[^>]*id="([^"]*)"[^>]*>', html)
print(f"Script IDs: {scripts}")

# 找所有 JSON 或数据相关的 script
json_scripts = re.findall(r'<script[^>]*type="application/json"[^>]*id="([^"]*)"', html)
print(f"JSON Script IDs: {json_scripts}")

# 打印前 500 字符
print(f"\nFirst 500 chars:\n{html[:500]}")
print(f"\nLast 500 chars:\n{html[-500:]}")