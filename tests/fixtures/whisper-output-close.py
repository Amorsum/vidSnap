"""不加载模型：关闭响应管道但保持进程存活，验证客户端 EOF 恢复。"""
import json
import os
import sys
import time

print(json.dumps({"type": "ready", "protocol": 1}), flush=True)
sys.stdin.readline()
os.close(sys.stdout.fileno())
time.sleep(30)
