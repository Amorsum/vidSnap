# Geist 本地字体资产

此目录固定项目原先通过 Google Fonts 使用的 Geist 与 Geist Mono；不升级字体或改动二进制。`fonts.css` 保留已有部署使用的 11 个 WOFF2 子集、Unicode 范围、100—900 可变字重、swap 策略，以及两个 Arial 回退字体的度量。字体通过 CSS 相对 URL 打包为同源静态资源，构建不再请求 Google Fonts。

来源为项目已验证部署中的 Google Fonts 原始字体字节，逐个 SHA-256 及长度见 `manifest.json`。字体仍属独立第三方资产；未把 `.next`、生成的 JS/CSS 包或缓存目录纳入源码。

字体作者与许可见 [OFL.txt](OFL.txt)，来源：[Google Fonts Geist](https://github.com/google/fonts/tree/main/ofl/geist)、[Geist Mono](https://github.com/google/fonts/tree/main/ofl/geistmono)。这两个字体当前使用相同的 OFL 1.1 许可文本。

更新时核对作者/许可、全部子集、Unicode 覆盖、可变字重、回退度量和 SHA-256；同时验证离线构建及桌面/移动端实际字体加载。不要用构建字体夹具替换此目录的真实字体。
