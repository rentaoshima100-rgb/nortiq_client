export function json(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

export function errorJson(
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return json({ error: message }, { status, headers });
}
