# M0 第三批：媒体出站边界验证

测试日期：2026-10-21。分支：`demo`。用户于 2026-10-22 确认本批提交并推送，报告随本次提交归档；M0 尚未整体完成。

## 预期与结果

| 验证 | 预期 | 实际 |
| --- | --- | --- |
| 既有 TS 回归 | 鉴权、限流、SSE、会话、缓存证据、删除竞态、TTL 和文件归属不退化 | 92/92 通过 |
| TS 接入回归 | yt-dlp 经有界 Python 包装；抖音下载只交给安全下载器，FFmpeg 只读本地且带协议限制 | 新增 2/2 通过 |
| Python 网络边界 | 域名/协议/端口、IPv4/IPv6/混合 DNS、固定 sockaddr、原域名 TLS、短链逐跳/循环/上限、下载/大小/错误清理、实际 CONNECT 转发及回收、子进程超时、上游数字 IP 隧道 | 新增 19/19 通过 |
| Chrome 负向 | 即使不安装 route 拦截，HTTP/HTTPS 环回、链路本地、IPv6 环回及合法域名解析到内网均由代理拒绝 | 5 个目标被拒；环回哨兵 TCP 连接 0 |
| 本地真实二进制 | yt-dlp 原生下载经代理完成 TLS/相对跳转；Chromium 允许访问白名单 HTTPS fixture；直链允许正常跳转、拒绝私网；FFmpeg 本地可用、网络输入被拒 | 全部通过，平台请求 0 |
| 静态检查 | lint、TypeScript、Python 语法 | 通过 |
| 隔离生产构建 | 编译、类型检查、10 个静态项和 6 个 API 路由 | 通过 |

自动测试合计 **113 项通过（94 TS + 19 Python）**，没有跳过；表格中的浏览器和二进制验证另列，不重复计入该数量。断言先定义预期，再运行；没有发生付费模型调用。

## 执行方式

- `npm run test:security`：既有回归加 TypeScript 接入测试，再执行 Python 标准库 unittest；测试专用访问码、限流桶和模拟上游，不读取真实 `.env.local`。
- `npx tsc --noEmit`、`npm run lint`：通过。
- Python 语法使用 `ast.parse` 检查本批改动，不导入/加载 Whisper 模型。
- `python -B tests/browser-egress.py`：本机 Chrome + Python Playwright，真实代理/浏览器、独立上下文；只在测试内把一个白名单域名的 DNS 改为环回，验证拒绝。无平台访问及 cookies 读取。
- `python -B tests/media-egress-smoke.py`：本机 yt-dlp 2026.08.19、FFmpeg、Chrome / Python Playwright 与 cryptography；临时生成 TLS 测试证书和短 WAV，测试内将白名单目标接到本地 fixture。原生下载和直链保留证书/主机名验证，浏览器仅在此测试上下文忽略自签测试证书；白名单浏览器路径、重定向和 FFmpeg 协议限制均实际执行。临时 CA 仅用于测试进程，生产未关闭证书检查。
- 构建复用已忽略的 `tmp/m0-session-validation` 副本，复制当前源码/脚本，副本限定 Turbopack 根目录；本项目正式 `.next` 和已有 3000/3001 服务没有重启或参与构建。不启动公网隧道。

## 实现期间修正

- 新接入测试最初把 mock 函数直接断言为完整 `execFile`，TS 报缺少 `__promisify__`；改为与既有测试一致的属性替换后，类型检查通过。
- 核对本机 yt-dlp 源码发现 ffprobe 并非所有路径都使用 postprocessor 参数；没有靠一个无效参数宣称隔离。改为关闭自动 fixup/直接合并，并为本批实际使用的 FFmpeg 下载兜底和字幕转换添加输入协议限制；真实原生下载验证通过。
- 禁用自动系统代理可能影响本机平台访问，因此增加显式可信上游配置；回归确认私网目标在联系上游之前被拒，允许目标只向上游提交已验证数字 IP。
- 真实浏览器允许路径测试中，后台请求取消后代理回送 403 曾产生已关闭连接异常栈；增加预期断连处理，拒绝行为不变，重跑通过。

## 限制与收尾

- 没有真实 YouTube/抖音解析、登录态、云端或本地 ASR、总结/视觉模型测试；没有性能改善或平台可用性结论。当前白名单、HTTPS-only、关闭自动 fixup 和原生下载策略需要真实部署网络冒烟，未知 CDN/依赖网络 FFmpeg 的格式会明确失败。
- 媒体默认不采用 Windows 系统代理或 HTTP(S)_PROXY/NO_PROXY；需要运维配置 `MEDIA_UPSTREAM_PROXY`，DNS 必须返回真实公网地址，不能使用 fake-IP。固定可信上游、路由、根证书仍属运维信任边界。
- 应用代理不替代系统/容器级出站规则，也不提供完整进程树取消。未引用的历史独立脚本不当作安全兜底；R1 Whisper 在途请求超时与恢复仍待实现。
- 新增测试的监听、浏览器及子进程均由本次测试回收，小型 TLS/音频 fixture 随临时目录清理。此前自动审批拒绝删除的隔离构建副本继续保留并被忽略，本轮没有再次尝试删除它。
- 保留原有 `.gitignore`、`AGENTS.md`、`.agents/`、`.codex/` 协作配置改动，不纳入本批范围。本批已获用户提交/推送授权，后续新增改动仍须重新概述并经用户确认。

实现依据核对了 [Playwright 网络文档](https://playwright.dev/python/docs/network)、[Chromium 代理及 loopback bypass 说明](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)、[yt-dlp 参数文档](https://github.com/yt-dlp/yt-dlp#usage-and-options) 与本机下载器实现；实际效果以上述测试为准。
