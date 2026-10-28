# 媒体出站访问边界

M0 第三批在 `scripts/media_network.py` 统一校验媒体出站，主处理与历史接口复用同一下载器。此实现保护显式接入的客户端，不是操作系统级沙箱，也不替代部署层防火墙。

## 访问规则

- 只接受 HTTPS 和 443 端口；Bilibili 的 `*.mcdn.bilivideo.cn` 额外允许 8082 端口，仍执行平台白名单及全量公网 DNS 校验。其他域名或平台的 8082 均不允许。拒绝 userinfo、控制字符、反斜线或尾点主机；入口仍由 `url-utils.ts` 校验视频路径。
- YouTube、Bilibili 与抖音使用各自的平台/CDN 域名后缀白名单，按域名边界匹配，拒绝 `youtube.com.evil.example` 等伪装。确切列表见 `HOSTS`，新增 CDN 必须结合实际失败地址审查，不能直接开放任意域名。
- 对 DNS 返回的全部 IPv4/IPv6 地址检查公网属性，拒绝混合公网/内网结果、环回、私网、链路本地、云元数据、共享地址、保留地址及 IPv6 过渡网络。直接连接刚刚校验的 sockaddr，不按原主机名进行第二次解析；TLS 仍验证原始域名及证书。
- 抖音短链接逐跳校验目标域名与路径，最多 5 次重定向，拒绝循环、空 Location 和跨域跳转；合法 `iesdouyin.com/share/video/<id>` 归一为标准视频页，再启动浏览器。HTML/脚本型短链跳转不绕过此规则。

Bilibili 的 `b23.tv` 短链同样最多逐跳跳转 5 次，只允许短链和 BV/av 视频页，保留合法分 P。B 站下载单独使用 `bilibili` 出站域名范围（`bilibili.com`、`b23.tv`、`bilivideo.com/cn/net`、`hdslb.com`），不会扩大 YouTube 或抖音的白名单。

## 客户端接入

| 客户端 | 执行边界 |
| --- | --- |
| yt-dlp | 元数据、字幕、音频、低清视频均经 Python 包装器和本次命令专属的环回 HTTP CONNECT 代理；每个新连接验证域名/DNS。忽略本机 yt-dlp 配置和插件目录，清除环境代理绕过规则，优先原生下载器 |
| yt-dlp 调用 FFmpeg | 禁用自动 fixup 与直接合并；下载器兜底和字幕转换显式限制输入协议为 `file,pipe`。需要 FFmpeg 直接访问网络的格式会失败，不自动退回无保护下载 |
| Playwright | 整个 Chromium 使用受控代理；取消默认 loopback bypass，禁用 QUIC 与非代理 WebRTC UDP，限制浏览器自身域名解析；阻止 service worker，增加请求 URL 白名单检查。安全边界不只依靠 route 拦截，重定向后的网络连接同样受代理检查 |
| 抖音直链 | 使用带域名/DNS/逐跳校验的 Python HTTPS 下载，保留 Referer；最多 5 次跳转，单文件最多 512 MiB、下载预算约 110 秒，外层进程有超时。失败清理本次目标文件 |
| 本地媒体处理 | 抖音音频提取、关键帧、两个 Whisper 脚本的 FFmpeg 输入协议仅 `file,pipe`；不再把抖音直链交给 FFmpeg |

CONNECT 代理只绑定 `127.0.0.1` 的随机端口，最多 32 个并发连接，设置请求/空闲/隧道期限；命令结束后关闭监听与本次连接。yt-dlp 的子进程预算先到，包装器保留清理时间。代理不记录请求头、Cookie、完整签名地址或上游凭据。

## 需要网络代理时

媒体访问默认直连**已验证的公网 IP**，不会自动读取 Windows 系统代理或 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`。下载器本地配置同样不再生效；原先依赖这些配置的环境需要显式迁移。

在本地 `.env.local` 设置 `MEDIA_UPSTREAM_PROXY=http://127.0.0.1:<HTTP或mixed端口>`，由应用传给 Python。该配置属于运维信任边界，不接受请求参数指定代理；可使用固定 HTTP 代理及可选 Basic 认证，不能把真实凭据写进版本库。Python 边界先解析并校验目标，再向此代理 CONNECT **已验证的目标公网 IP 和允许端口**，目标 TLS 保持原始域名验证。不能在失败时自动回退到任意代理或不受保护的直连。

### 本机代理返回 fake-IP 时

`MEDIA_DNS_MODE=system` 为默认值，使用系统 DNS。代理软件的 fake-IP DNS（例如 `198.18.0.0/15`）会被拒绝。可在 VidSnap 的 `.env.local` 设置 `MEDIA_DNS_MODE=doh` 并重启服务，让媒体客户端独立解析真实地址；不需要关闭安全校验、修改系统 DNS 或切换代理节点。

DoH 模式使用固定的阿里公共加密 DNS 服务 `dns.alidns.com`，以公开引导 IP `223.5.5.5` / `223.6.6.6` 建立 HTTPS 连接并验证解析服务证书。查询 A 和 AAAA，核对问题域名/类型、响应结构及大小；缓存遵守返回 TTL 且不超过 60 秒、最多 256 个域名。仅查询平台域名，不发送视频路径、Cookie 或模型密钥。该模式会将平台域名查询发送给此解析服务。

下载前仍检查域名、端口与所有返回地址的公网属性，实际连接固定到已验证 IP，目标 TLS 保留原域名验证。DoH 失败或返回内网/虚拟地址时明确失败，不自动退回系统 DNS，也不接受用户请求指定解析服务器。若配置了 `MEDIA_UPSTREAM_PROXY`，解析服务及媒体连接均通过该固定代理，CONNECT 目标仍为已验证 IP。

可信解析服务、上游代理、主机路由及 TLS 根证书仍由运维负责。网络连接是否可达与 DNS 是否正确是两项独立条件；例如 YouTube 出站受限时仍需可用的显式媒体代理。

## 验证与剩余范围

`npm run test:security` 包含 TypeScript 回归与 Python 标准库网络测试；Python 是当前 YouTube 下载的必要依赖。`python -B tests/browser-egress.py` 用已安装的 Chrome / Python Playwright 验证绕过防护；`python -B tests/media-egress-smoke.py` 额外需要 yt-dlp、FFmpeg、cryptography，使用本地 TLS fixture 验证真实二进制及浏览器允许路径。测试不访问平台、登录态或付费模型。

这批没有证明真实 YouTube/抖音在当前网络及登录态下可用。平台 CDN 变动、代理路由和 DNS 策略需在实际部署环境补充冒烟；新增 CDN 必须审查白名单。应用级代理不能限制已被攻陷的浏览器/下载器任意系统调用，生产仍建议独立 Worker 配合系统/容器出站策略。旧的未被主链路引用的 `scripts/douyin_extractor.py` 不在此接入范围，不应当作公开接口的网络兜底。

第三批本身不实现持久任务、完整进程树取消或 Whisper 队列恢复。后续第四批的单进程恢复见 [Whisper 恢复说明](WHISPER_RECOVERY.md)，持久任务仍待 M3。
