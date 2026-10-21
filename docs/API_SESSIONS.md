# 匿名会话与分析资源

M0 第二批使用单 Node 进程内的匿名会话与分析记录；没有引入账号或数据库。共享访问码负责门禁，资源归属由服务端会话决定。

## 请求与身份

- 成功调用 `POST /api/verify` 或首次通过校验的 `POST /api/process` 会签发 `vidsnap-session` Cookie：HttpOnly、SameSite=Lax、Path=/，生产环境及 HTTPS 请求使用 Secure，有效期固定 24 小时。后续调用复用 Cookie，不在 JSON 响应返回会话凭据。
- 同源浏览器请求自动携带 Cookie；手动 API 客户端必须保存并复用 Cookie。`body.sessionId`、查询参数、陌生 Cookie 值都不能注册身份或授权资源。
- 写接口要求 `Content-Type: application/json`。有 Origin 时校验其协议和目标 Host，拒绝跨站、同站不同主机及 Origin=null；无 Origin 的 JSON 请求兼容命令行客户端。HTTPS 代理入口保留原 Host 时可用，代理头不能当作可靠身份。
- 原访问码和接口/IP 限流继续生效。浏览器 cookie 归属不能替代访问码，访问码也不能替代资源归属。

## 分析 ID 与兼容字段

`POST /api/process` 继续返回原 SSE 协议。解析视频元信息后，progress 事件增加 `analysisId`；result 的 data 增加相同字段。`video.id` 仍是真实平台视频 ID，transcriptSegments、frames、metrics 和原流事件语义保持不变。

追问和删除应同时传入 `videoId` 与 `analysisId`：

| 接口 | 请求/结果 |
| --- | --- |
| `POST /api/followup` | JSON：videoId、analysisId、question；保留 answer、retrievalSource、toolsUsed，成功时增加 analysisId |
| `DELETE /api/process` | JSON：videoId、analysisId；成功仍返回 success=true |
| `GET /api/frames` | result.frames 中的完整 URL，包含 videoId、analysisId、idx、token；仍需同一会话 Cookie |

旧客户端只传 videoId 时，仅在当前会话内存在唯一有效分析时兼容；多份分析或跨平台 ID 碰撞时拒绝猜测目标。建议始终回传 result.analysisId。缺失、他人、已删除或过期资源统一返回 404；错误字段类型/ID 格式返回 400，门禁失败 401，来源校验失败 403，限流 429 并带 Retry-After。

单进程最多保存 10000 个未过期会话、1000 条未过期分析记录；达到上限时拒绝新增，不驱逐有效资源。会话容量满返回 503，流开始后的分析容量错误通过原 SSE error 事件返回；这些情况不归类为 JSON 格式错误。字节预算与持久配额仍待后续实现。

帧图同时校验会话归属与签名/访问码；访问码回退仍保留，但不能读取别人的图片。签名绑定 analysisId 与原始帧索引，重排描述或备用模型补齐不会给图片重新编号。响应使用 private, no-store，使删除后的再次请求重新检查归属。

## 缓存、删除和期限

- 只复用同会话、同平台、同视频的有效已完成分析。不同会话同视频分别处理，不共享结果、字幕、对话或产物。当前不合并在途请求，该能力留到 M1。
- 结果、完整证据与对话使用同一个绝对到期时间：总结完成后 1 小时。缓存读取和追问不续期；完整证据包括字幕、画面段落及其可用向量。画面时间与图片源索引独立保留。
- 帧文件和签名默认在抽帧完成后 2 小时到期；帧目录有独立到期清理，结果仍有效也不延长帧保存。缓存响应移除已过期的帧 URL。
- 每次分析使用服务端 UUID 目录 `%TEMP%/vidsnap/analyses/<analysisId>/`，媒体与帧分别放在 media、frames。成功后清理媒体；失败后清理整份分析；目录校验拒绝路径穿越与链接逃逸。主处理和 DELETE 不再按平台 videoId 前缀扫描共享文件。
- DELETE 先撤销分析写入权，再失效结果/证据/对话并删除本分析目录。外部阶段返回后再检查状态，禁止旧总结或追问恢复已删除内容。字幕重试/降级前也检查状态。

删除不是强杀媒体进程或立即中止所有外部模型请求：当前阶段可能需要等待其结束，再进行收尾；结果不得回写。持久任务取消、全链路预算和进程级取消属于后续任务系统。

重启后会话与内存内容失效，旧 Cookie/帧签名不能恢复访问；帧目录依靠定时器及启动后首次新分析的到期扫描扫尾。尚无持久恢复、账号体系或跨实例共享状态。升级前的旧结果需要重新分析，以建立新的归属关系。
