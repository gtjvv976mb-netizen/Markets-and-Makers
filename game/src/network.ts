export interface DeploymentStatus {
  mode: "local" | "render" | "unavailable";
  label: string;
}

export async function detectDeployment(): Promise<DeploymentStatus> {
  const base = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.replace(/\/$/, "");
  if (!base) return { mode: "local", label: "Local authority" };
  try {
    const response = await fetch(`${base}/health`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { mode: "unavailable", label: "Server degraded" };
    const health = await response.json() as { status?: string; database?: string };
    return health.status === "ok" && health.database === "ready"
      ? { mode: "render", label: "Render authority" }
      : { mode: "unavailable", label: "Server configuring" };
  } catch {
    return { mode: "unavailable", label: "Offline fallback" };
  }
}
