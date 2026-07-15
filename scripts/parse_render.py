"""解析 RENDER_DATA"""
import re, json
from urllib.parse import unquote

html = open('tmp/douyin_debug.html', 'r', encoding='utf-8').read()
m = re.search(r'<script id="RENDER_DATA"[^>]*>(.*?)</script>', html, re.DOTALL)
if m:
    data = m.group(1)
    print(f"Raw data length: {len(data)}")
    decoded = unquote(data)
    print(f"Decoded data length: {len(decoded)}")
    print(f"First 500 chars: {decoded[:500]}")
    try:
        parsed = json.loads(decoded)
        print(f"\nParsed! Top-level keys: {list(parsed.keys())}")
        
        # 递归查找 aweme
        def find_aweme(obj, depth=0):
            if depth > 10:
                return None
            if isinstance(obj, dict):
                if "aweme" in obj:
                    return obj
                for k, v in obj.items():
                    if k.lower() == "aweme" and isinstance(v, dict):
                        return v
                for k, v in obj.items():
                    r = find_aweme(v, depth+1)
                    if r:
                        return r
            elif isinstance(obj, list):
                for item in obj:
                    r = find_aweme(item, depth+1)
                    if r:
                        return r
            return None
        
        # 也尝试找任何包含 video/audio 的深层结构
        def find_video_info(obj, depth=0):
            if depth > 10:
                return None
            if isinstance(obj, dict):
                if "video" in obj and "desc" in obj:
                    return obj
                for k, v in obj.items():
                    r = find_video_info(v, depth+1)
                    if r:
                        return r
            elif isinstance(obj, list):
                for item in obj:
                    r = find_video_info(item, depth+1)
                    if r:
                        return r
            return None

        aweme = find_aweme(parsed)
        if aweme:
            print(f"\nFound aweme data! Keys: {list(aweme.keys())}")
            if isinstance(aweme, dict) and "aweme" in aweme:
                print(f"aweme.detail keys: {list(aweme['aweme'].keys()) if isinstance(aweme['aweme'], dict) else 'not dict'}")
        else:
            print("\nNo aweme found in direct search")
            video = find_video_info(parsed)
            if video:
                print(f"Found video info: {list(video.keys())}")
            else:
                print("No video info found")
                # Print all keys at depth 1-2
                for k, v in parsed.items():
                    if isinstance(v, dict):
                        print(f"  {k}: {list(v.keys())[:10]}")
                    elif isinstance(v, list):
                        print(f"  {k}: list of {len(v)} items")
                    else:
                        print(f"  {k}: {str(v)[:100]}")
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
else:
    print("RENDER_DATA not found")