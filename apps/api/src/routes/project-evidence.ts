import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { EvidenceProjectInputSchema, EvidenceProjectSummarySchema } from '@techspar/contracts'
import type { ProjectEvidenceService, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'
export function registerProjectEvidenceRoutes(app: OpenAPIHono, deps: { evidence: ProjectEvidenceService; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/project-evidence', responses: { 200: { content: { 'application/json': { schema: z.object({ items: z.array(EvidenceProjectSummarySchema) }) } }, description: 'Local project evidence versions' } } }), async c => c.json({ items: await deps.evidence.list(await authenticatedContext(c, deps.tokens)) }))
  app.openapi(createRoute({ method: 'post', path: '/api/project-evidence', request: { body: { content: { 'application/json': { schema: EvidenceProjectInputSchema } } } }, responses: { 200: { content: { 'application/json': { schema: EvidenceProjectSummarySchema } }, description: 'Import an immutable project snapshot' } } }), async c => c.json(await deps.evidence.import(await authenticatedContext(c, deps.tokens), c.req.valid('json'))))
}
