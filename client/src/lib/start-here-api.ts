export type StartHereBootstrapWorkspace = {
  workspaceId: string;
  name: string;
  dashboard: unknown;
  extras: Record<string, unknown>;
};

async function readApiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error.trim();
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return fallback;
}

export async function fetchStartHereBootstrap(): Promise<{
  activeWorkspaceId: string | null;
  workspaces: StartHereBootstrapWorkspace[];
}> {
  const res = await fetch("/api/sentinel/start-here/bootstrap", { credentials: "include" });
  if (!res.ok) {
    const msg = await readApiErrorMessage(res, `Start bootstrap failed (${res.status})`);
    throw new Error(msg);
  }
  return res.json();
}

export async function putStartHereWorkspace(payload: {
  workspaceId: string;
  name: string;
  dashboard: unknown;
  extras: Record<string, unknown>;
}): Promise<void> {
  const res = await fetch(
    `/api/sentinel/start-here/workspace/${encodeURIComponent(payload.workspaceId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        dashboard: payload.dashboard,
        extras: payload.extras,
      }),
    }
  );
  if (!res.ok) {
    const msg = await readApiErrorMessage(res, `Save workspace failed (${res.status})`);
    throw new Error(msg);
  }
}

export async function deleteStartHereWorkspace(workspaceId: string): Promise<void> {
  const res = await fetch(
    `/api/sentinel/start-here/workspace/${encodeURIComponent(workspaceId)}`,
    { method: "DELETE", credentials: "include" }
  );
  if (!res.ok) {
    const msg = await readApiErrorMessage(res, `Delete workspace failed (${res.status})`);
    throw new Error(msg);
  }
}

export async function patchStartHereActive(workspaceId: string): Promise<void> {
  const res = await fetch("/api/sentinel/start-here/active", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!res.ok) {
    const msg = await readApiErrorMessage(res, `Set active workspace failed (${res.status})`);
    throw new Error(msg);
  }
}
