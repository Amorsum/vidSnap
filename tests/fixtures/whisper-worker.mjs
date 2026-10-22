import readline from "node:readline";
const mode = process.argv[2] ?? "normal";
const keepAlive = setInterval(() => {}, 1000);
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
if (mode === "crash-start") process.exit(2);
if (mode !== "silent-start") send({ type: "ready", protocol: mode === "old-protocol" ? 0 : 1 });
if (mode === "closed-stdin") process.stdin.destroy();
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const id = request.request_id;
  const action = request.audio_path;
  const result = { type: "result", request_id: id, text: `${action} 中文🚀`,
    segments: [{ start: 0, end: 1, text: "中文🚀" }], language: request.language ?? "zh" };
  if (action === "crash") process.exit(3);
  if (action === "bad-json") { process.stdout.write("broken json\n"); return; }
  if (action === "oversize") { process.stdout.write("x".repeat(11 * 1024 * 1024)); return; }
  if (action === "hang" || action === "forever-progress") {
    send({ type: "progress", request_id: id, percent: 0 });
    if (action === "forever-progress") setInterval(() => send({ type: "progress", request_id: id, percent: 30 }), 20);
    return;
  }
  if (action === "error") { send({ type: "error", request_id: id, error: "/private/internal/path" }); return; }
  if (action === "invalid-segment") { send({ ...result, segments: [{ start: 5, end: 1, text: "bad" }] }); return; }
  if (action === "wrong-id") send({ ...result, request_id: "other-request", text: "不能返回此内容" });
  if (action === "progress") for (const percent of [-1, "50", 101, 25, 100]) send({ type: "progress", request_id: id, percent });
  if (action === "utf8") {
    const bytes = Buffer.from(JSON.stringify(result) + "\n");
    const middle = bytes.indexOf(Buffer.from("中")) + 1;
    process.stdout.write(bytes.subarray(0, middle));
    setTimeout(() => process.stdout.write(bytes.subarray(middle)), 5);
    return;
  }
  if (action === "stderr") process.stderr.write("test log\n".repeat(100000));
  send(result);
  if (action === "duplicate") {
    send({ ...result, text: "重复内容" });
    setTimeout(() => send({ ...result, text: "迟到内容" }), 10);
  }
});
process.on("SIGTERM", () => { clearInterval(keepAlive); process.exit(); });
