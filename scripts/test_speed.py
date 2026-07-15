import urllib.request
import json
import time

t = time.time()
req = urllib.request.Request(
    "http://localhost:3000/api/process",
    data=json.dumps({"url": "https://youtu.be/9cS2wv6AfHk", "action": "summarize"}).encode(),
    headers={"Content-Type": "application/json"},
)
r = urllib.request.urlopen(req, timeout=300)
data = json.loads(r.read())
elapsed = time.time() - t

print(f"Success: {data.get('success')}")
print(f"Title: {data.get('video', {}).get('title', 'N/A')}")
print(f"Duration: {data.get('video', {}).get('duration', '?')}s")
print(f"Source: {data.get('transcriptSource', '?')}")
print(f"Elapsed: {elapsed:.1f}s")