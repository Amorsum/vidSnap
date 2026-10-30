# 总结时间引用检查

此工具属于 N3 的离线评测，不需要数据库、环境变量或模型调用。可在网站导出 JSON 笔记备份后运行，也支持单份 `AnalysisResult` JSON。输入只在本机读取，原文件不修改。

```powershell
npm run check:citations -- "D:\备份\vidsnap-notebook.json"
```

若要保存纯 JSON 报告，直接调用入口，避免 npm 的命令提示混入报告：

```powershell
npx tsx scripts/eval/citation-audit.ts "D:\备份\vidsnap-notebook.json" > "D:\备份\citation-report.json"
```

输出按 `analysisIndex`、`chapterIndex`、`pointIndex` 定位到输入顺序；`transcriptIndexes` 和 `frameIndexes` 是原文和画面数组的索引。文件 SHA-256 用于区分评测输入版本。报告不包含原文、总结、个人笔记、会话标识、输入路径或帧 URL。

| 检查 | 含义 |
| --- | --- |
| `invalid_time` | 要点时间无法按 MM:SS 或 HH:MM:SS 解析 |
| `outside_video` | 要点时间超过视频时长 |
| `outside_chapter` | 要点时间落在所属章节之外 |
| `no_temporal_evidence` | 该时间未落入有文字的字幕段，也不对应有描述的画面 |
| `flaggedChapters` | 开始或结束时间超过视频时长的章节数 |
| `emptySummary` | 没有可检查的要点，不能当作质量通过 |

退出码：`0` 表示未发现上述时间问题，`1` 表示存在待核查项，`2` 表示参数、文件或结构错误。最大输入 20 MiB，备份沿用现有格式及数量校验；不会部分接受损坏备份。

字幕起始时间允许向下取整到整数秒，与生产 Prompt 的时间格式一致；画面按同一整数秒匹配。其余位置不自动放宽或改写，也不补造字幕。未知或估算时间通过 `transcriptionTiming` 原样标明。

**时间匹配不代表事实依据匹配。** 一条“支持自动扣款”的总结即使引用到“不支持自动扣款”的字幕，也可能通过时间检查。报告始终标注 `factualSupport: not_evaluated`；事实、否定词、数字含义、内容覆盖和复习题质量需要人工或后续模型评测。通过也不代表真实秒级对齐；发现空档时应先检查字幕时间精度。
