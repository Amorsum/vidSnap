"""用 requests + cookies.txt 调 Douyin API"""
import requests, json, re, sys, os

cookies_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cookies.txt")

# 解析 Netscape cookies.txt
cookies_dict = {}
with open(cookies_path) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) >= 7:
            name, value = parts[5], parts[6]
            cookies_dict[name] = value

print(f"Loaded {len(cookies_dict)} cookies")

session = requests.Session()
session.cookies.update(cookies_dict)
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Referer": "https://www.douyin.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
})

# 解析短链接
short_url = sys.argv[1] if len(sys.argv) > 1 else "https://v.douyin.com/u6Oo6BRr_xg/"
resp = session.get(short_url, allow_redirects=True)
resolved_url = resp.url
print(f"Resolved: {resolved_url}")

match = re.search(r'/video/(\d+)', resolved_url)
if not match:
    print("Cannot extract video ID")
    sys.exit(1)
video_id = match.group(1)
print(f"Video ID: {video_id}")

# 调用 API
api_url = f"https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id={video_id}"
print(f"Calling API: {api_url}")

resp = session.get(api_url, headers={
    "Referer": f"https://www.douyin.com/video/{video_id}",
})
print(f"Status: {resp.status_code}")
print(f"Response length: {len(resp.text)}")
print(f"Response: {resp.text[:500]}")

if resp.status_code == 200 and resp.text.strip():
    try:
        data = resp.json()
        print(f"\nJSON keys: {list(data.keys())}")
    except:
        print("Not valid JSON")
else:
    print("\nEmpty/missing response, trying with more headers...")
    resp2 = session.get(api_url, headers={
        "Referer": f"https://www.douyin.com/video/{video_id}",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    })
    print(f"Status: {resp2.status_code}, Length: {len(resp2.text)}")
    print(f"Response: {resp2.text[:500]}")