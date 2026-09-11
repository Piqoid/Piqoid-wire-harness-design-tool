import type { Diagnostic, HarnessData, LayoutData, ProjectMeta, SignalProfile } from "../types";

const BASE = "";  // same origin

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
  return r.json();
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
    } catch { /* heartbeat or error */ }
  };
  return ws;
}
