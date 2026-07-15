"""从抖音 HTML 中提取所有 __pace_f 数据块"""
import re, json, os
from urllib.parse import unquote

html = open('tmp/douyin_debug.html', 'r', encoding='utf-8').read()

# 找到所有 __pace_f.push 数据块
pattern = r'self\.__pace_f\.push\(\[1,"(.*?)"\]'
matches = re.findall(pattern, html)

# 也找不带 1, 前缀的
pattern2 = r'self\.__pace_f\.push\(\[(\d+),"((?:[^"\\]|\\.)*?)"\]'
matches2 = re.findall(pattern2, html)

for i, (idx, data) in enumerate(matches2):
    decoded = unquote(data)
    print(f"\nChunk {i} (index={idx}, raw={len(data)}, decoded={len(decoded)}):")
    try:
        parsed = json.loads(decoded)
        if isinstance(parsed, dict):
            keys = list(parsed.keys())
            print(f"  Keys: {keys[:10]}")
            # 深度查找 aweme
            def find_key(obj, target, depth=0):
                if depth > 10: return None
                if isinstance(obj, dict):
                    if target in obj: return obj[target]
                    for v in obj.values():
                        r = find_key(v, target, depth+1)
                        if r: return r
                elif isinstance(obj, list):
                    for item in obj:
                        r = find_key(item, target, depth+1)
                        if r: return r
                return None
            aweme = find_key(parsed, 'aweme')
            if aweme:
                print(f"  *** FOUND aweme! desc: {aweme.get('desc', 'N/A')[:50]}")
            detail = find_key(parsed, 'aweme_detail')
            if detail:
                print(f"  *** FOUND aweme_detail! desc: {detail.get('desc', 'N/A')[:50]}")
        elif isinstance(parsed, list):
            print(f"  List of {len(parsed)} items, first: {str(parsed[0])[:100]}")
    except:
        print(f"  Not valid JSON, first 100: {decoded[:100]}")