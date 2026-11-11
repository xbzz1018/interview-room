import { API_BASE, authFetch, type ApiResponse } from './client';
import { responseErrorText } from './errors';
export type EvidenceProjectSummary = ApiResponse<'/api/project-evidence', 'get'>['items'][number];
export type EvidenceHit = NonNullable<ApiResponse<'/api/interview/reference-answer', 'post'>['sources']>[number];
export async function getEvidenceProjects() {
  const response = await authFetch(`${API_BASE}/project-evidence`);
  if (!response.ok) throw new Error(await responseErrorText(response));
  return response.json() as Promise<{ items: EvidenceProjectSummary[] }>;
}
export async function importEvidenceProject(value: unknown) {
  const response = await authFetch(`${API_BASE}/project-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(await responseErrorText(response));
  return response.json() as Promise<EvidenceProjectSummary>;
}
