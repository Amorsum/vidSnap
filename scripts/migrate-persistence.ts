import { migratePersistence } from "../src/lib/persistence/migrate";

const connectionString = process.env.VIDSNAP_DATABASE_URL;
if (!connectionString) {
  console.error("请先设置 VIDSNAP_DATABASE_URL；迁移不会自动运行。");
  process.exitCode = 1;
} else {
  migratePersistence(connectionString).then(() => console.log("存储迁移已完成。"), () => {
    // 数据库驱动错误可能包含连接详情，不向终端打印原始异常。
    console.error("存储迁移失败，请检查连接、权限与已执行迁移的版本。");
    process.exitCode = 1;
  });
}
