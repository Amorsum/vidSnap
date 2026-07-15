"""检查 Firefox 中是否有抖音 cookie"""
import sqlite3
import os

profile_dir = os.path.expandvars(
    r"%APPDATA%\Mozilla\Firefox\Profiles"
)
# 找到 default-release 目录
for name in os.listdir(profile_dir):
    if name.endswith(".default-release"):
        db_path = os.path.join(profile_dir, name, "cookies.sqlite")
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            cursor = conn.execute(
                "SELECT name, host, value FROM moz_cookies WHERE host LIKE '%douyin%'"
            )
            rows = cursor.fetchall()
            print(f"Found {len(rows)} Douyin cookies in {name}:")
            for row in rows:
                print(f"  {row[0]} @ {row[1]} = {row[2][:50]}...")
            conn.close()
            break