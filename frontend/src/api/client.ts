import type { Diagnostic, HarnessData, LayoutData, ProjectMeta, SignalProfile } from "../types";

const BASE = "";  // same origin

// ── reads ─────────────────────────────────────────────────────────────────────

export async function fetchProject(): Promise<{ meta: ProjectMeta; harness_names: string[] }> {
  const r = await fetch(`${BASE}/api/project`);
  if (!r.ok) throw new Error(`GET /api/project: ${r.status}`);
  return r.json();
}

export async function fetchHarness(name: string): Promise<HarnessData> {
  const r = await fetch(`${BASE}/api/harness/${name}`);
  if (!r.ok) throw new Error(`GET /api/harness/${name}: ${r.status}`);
  return r.json();
}

export async function fetchLayout(name: string): Promise<LayoutData> {
  const r = await fetch(`${BASE}/api/layout/${name}`);
  if (!r.ok) throw new Error(`GET /api/layout/${name}: ${r.status}`);
  const data = await r.json();
  // Ensure edges field exists
  return { edges: {}, ...data };
}

export async function fetchValidation(name: string): Promise<Diagnostic[]> {
  const r = await fetch(`${BASE}/api/validate/${name}`);
  if (!r.ok) throw new Error(`GET /api/validate/${name}: ${r.status}`);
  return r.json();
}

export async function fetchProfiles(): Promise<SignalProfile[]> {
  const r = await fetch(`${BASE}/api/profiles`);
  if (!r.ok) return [];
  return r.json();
}

export function connectValidationWS(
  harnessName: string,
  onMessage: (diags: Diagnostic[]) => void,
): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/validate/${harnessName}`);
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (Array.isArray(data)) onMessage(data as Diagnostic[]);
    } catch { /* heartbeat */ }
  };
  return ws;
}

// ── mutations ─────────────────────────────────────────────────────────────────

export async function createEntity(
  harness: string,
  entityType: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/harness/${harness}/entities/${entityType}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail ?? r.statusText);
  }
  return r.json();
}

export async function updateEntity(
  harness: string,
  entityType: string,
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/api/harness/${harness}/entities/${entityType}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail ?? r.statusText);
  }
  return r.json();
}

export async function deleteEntity(
  harness: string,
  entityType: string,
  id: string,
): Promise<void> {
  const r = await fetch(`${BASE}/api/harness/${harness}/entities/${entityType}/${id}`, {
    method: "DELETE",
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail ?? r.statusText);
  }
}

export async function saveLayout(harness: string, layout: LayoutData): Promise<void> {
  const r = await fetch(`${BASE}/api/layout/${harness}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
  });
  if (!r.ok) throw new Error(`PUT /api/layout/${harness}: ${r.status}`);
}

export async function validateHypothetical(
  harnessName: string,
  fromPortId: string,
  toPortId: string,
): Promise<{ severity: "ok" | "warn" | "error"; message: string; rule_id: string | null }> {
  const r = await fetch(`${BASE}/api/validate/hypothetical`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ harness_name: harnessName, from_port_id: fromPortId, to_port_id: toPortId }),
  });
  if (!r.ok) return { severity: "ok", message: "", rule_id: null };
  return r.json();
}
