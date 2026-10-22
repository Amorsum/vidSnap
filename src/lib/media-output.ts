import fs from "node:fs/promises";
import path from "node:path";

/** 使用下载器报告的最终路径，拒绝临时文件、链接文件、其他视频及目录外输出。 */
export async function resolveMediaOutput(stdout: string, directory: string, basename: string, extensions: readonly string[]): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(basename)) throw new Error("媒体文件 ID 无效");
  const reported: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "string") reported.push(value);
    } catch { /* 非机器输出不参与路径选择，也不回显到客户端。 */ }
  }
  if (reported.length !== 1 || !path.isAbsolute(reported[0])) throw new Error("下载器未返回唯一的最终媒体路径");
  const file = path.resolve(reported[0]);
  const relative = path.relative(path.resolve(directory), file);
  const extension = path.extname(relative).slice(1);
  if (path.dirname(relative) !== "." || path.basename(relative, `.${extension}`) !== basename || !extensions.includes(extension)) {
    throw new Error("下载器返回了不合法的媒体路径");
  }
  const stat = await fs.lstat(file).catch(() => { throw new Error("下载后的媒体文件不存在或无法读取"); });
  if (!stat.isFile() || stat.size === 0) throw new Error("媒体文件为空或不是常规文件");
  return file;
}
