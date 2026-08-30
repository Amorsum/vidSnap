/**
 * SSE 流读取工具：按行产出完整的 SSE 行（多 chunk 拆行 + 保留末尾不完整行）
 * 供前端事件解析（page.tsx）与 DeepSeek 流式解析（llm.ts）共用
 */
export async function* sseLines(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    yield* lines;
  }

  // 流结束时若有未换行的残留内容也产出（服务端正常总会以 \n\n 结尾，此为兜底）
  if (buffer) yield buffer;
}
