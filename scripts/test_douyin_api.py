"""直接测试 Douyin API"""
import sqlite3, os, json, urllib.request, http.cookiejar

# 1. 从 Firefox 读取 cookie
profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
for name in os.listdir(profile_dir):
    if name.endswith(".default-release"):
        db_path = os.path.join(profile_dir, name, "cookies.sqlite")
        break

conn = sqlite3.connect(db_path)
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

# 3. 调用 API
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
req = urllib.request.Request(
    "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7661190102001133730",
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.douyin.com/",
    }
)
try:
    resp = opener.open(req)
    data = resp.read().decode()
    print(f"Status: {resp.status}")
    print(f"Response length: {len(data)}")
    print(f"Response: {data[:500]}")
except Exception as e:
    print(f"Error: {e}")