import type { FastifyReply, FastifyRequest } from 'fastify'

/** Sous-ensemble de JSON Schema 2020-12 (celui d'OpenAPI 3.1). */
export type Schema = Record<string, unknown>

/** Définition d'une route : SOURCE UNIQUE de l'enregistrement Fastify et du document OpenAPI. */
export interface RouteDef {
  method: 'GET' | 'POST' | 'DELETE'
  url: string
  summary: string
  query?: Record<string, Schema>
  body?: Schema
  /** Réponses par code HTTP ; `null` = réponse sans corps. */
  responses: Record<number, Schema | null>
  handler(req: FastifyRequest, reply: FastifyReply): unknown
}

// Constructeurs de schémas.
export const str: Schema = { type: 'string' }
export const int: Schema = { type: 'integer' }
export const num: Schema = { type: 'number' }
export const bool: Schema = { type: 'boolean' }
export const any: Schema = {}
export const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: 'null' }] })
export const arr = (items: Schema): Schema => ({ type: 'array', items })
export const map = (values: Schema): Schema => ({ type: 'object', additionalProperties: values })
/** Objet : toutes les propriétés listées sont requises sauf celles de `optional`. */
export const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
})
export const page = (items: Schema): Schema =>
  obj({ total: int, limit: int, offset: int, items: arr(items) })
export const error: Schema = obj({ error: str })

const pathParams = (url: string) => [...url.matchAll(/:(\w+)/g)].map((m) => String(m[1]))

/** Document OpenAPI 3.1 GÉNÉRÉ à partir des définitions de routes (jamais écrit à la main). */
export function openApi(defs: RouteDef[], version: string): Schema {
  const paths: Record<string, Record<string, Schema>> = {}
  for (const d of defs) {
    const path = d.url.replace(/:(\w+)/g, '{$1}')
    const parameters = [
      ...pathParams(d.url).map((name) => ({ name, in: 'path', required: true, schema: str })),
      ...Object.entries(d.query ?? {}).map(([name, schema]) => ({
        name,
        in: 'query',
        required: false,
        schema,
      })),
    ]
    const responses = Object.fromEntries(
      Object.entries(d.responses).map(([code, schema]) => [
        code,
        schema === null
          ? { description: code }
          : { description: code, content: { 'application/json': { schema } } },
      ]),
    )
    paths[path] = {
      ...paths[path],
      [d.method.toLowerCase()]: {
        operationId: `${d.method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+(.)?/g, (_w, c?: string) => (c ?? '').toUpperCase())}`,
        summary: d.summary,
        parameters,
        ...(d.body === undefined
          ? {}
          : {
              requestBody: { required: true, content: { 'application/json': { schema: d.body } } },
            }),
        responses,
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Varia API', version },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { token: { type: 'apiKey', in: 'header', name: 'x-varia-token' } },
    },
    paths,
  }
}
