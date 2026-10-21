export class RequestValidationError extends Error {}
export class ServiceCapacityError extends Error {}

/** JSON 类型在运行时校验，避免 null、数组与类型断言绕过边界。 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestValidationError("请求格式错误，请提供 JSON 对象");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestValidationError("请求格式错误，请提供 JSON 对象");
  }
  return body as Record<string, unknown>;
}

export function isValidVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isValidQuestion(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4000;
}
