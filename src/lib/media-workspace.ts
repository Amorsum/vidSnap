import fs from "fs/promises";
import os from "os";
import path from "path";

/** 历史接口每次调用独占目录，失败与成功都只清理本次创建的媒体。 */
export async function withMediaWorkspace<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const root = path.join(os.tmpdir(), "vidsnap");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "legacy-"));
  try {
    return await run(directory);
  } finally {
    const relative = path.relative(root, directory);
    if (path.dirname(relative) !== "." || !relative.startsWith("legacy-")) {
      throw new Error("拒绝清理工作目录之外的路径");
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
