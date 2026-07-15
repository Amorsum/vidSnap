"""导出 Firefox cookies 为 Netscape 格式 cookies.txt"""
import sqlite3, os, shutil, tempfile

profile_dir = os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles")
for name in os.listdir(profile_dir):
    if name.endswith(".default-release"):
        db_path = os.path.join(profile_dir, name, "cookies.sqlite")
        break

tmp = os.path.join(tempfile.gettempdir(), "cookies_export.sqlite")
shutil.copy2(db_path, tmp)
conn = sqlite3.connect(tmp)
cursor = conn.execute("SELECT name, host, value, path, expiry, isSecure FROM moz_cookies WHERE host LIKE '%douyin%'")
cookies = cursor.fetchall()
conn.close()
os.unlink(tmp)

output = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cookies.txt")
with open(output, "w") as f:
    f.write("# Netscape HTTP Cookie File\n")
    f.write("# This is a generated file! Do not edit.\n\n")
    for name, host, value, path, expiry, is_secure in cookies:
        secure = "TRUE" if is_secure else "FALSE"
        domain_flag = "TRUE" if host.startswith(".") else "FALSE"
        f.write(f"{host}\t{domain_flag}\t{path}\t{secure}\t{expiry}\t{name}\t{value}\n")

print(f"Exported {len(cookies)} cookies to {output}")