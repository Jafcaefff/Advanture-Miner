export type ApiError = { error: { code: string; message: string; requestId: string } };

export async function apiFetch<T>(path: string, opts?: { method?: string; body?: any; token?: string }): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? "GET",
    headers: {
      ...(opts?.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts?.body ? { "content-type": "application/json" } : {})
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (json ?? { error: { code: "UNKNOWN", message: "Unknown", requestId: "" } }) as ApiError;
    throw new Error(`${err.error.code}: ${err.error.message} (${err.error.requestId})`);
  }
  return json as T;
}

