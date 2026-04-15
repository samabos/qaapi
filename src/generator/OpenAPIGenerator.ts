import * as crypto from 'crypto';
import { TestSuite, Journey, Step, HttpMethod } from '../types';

type Spec = Record<string, unknown>;
type PathItem = Record<string, unknown>;
type Operation = Record<string, unknown>;
type Schema = Record<string, unknown>;
type Parameter = Record<string, unknown>;

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Deterministic Postman-style generator. One journey per operation, one step
 * per journey, seeded directly from the dereferenced OpenAPI spec. No AI,
 * no source-code inspection, no cross-endpoint chaining.
 */
export class OpenAPIGenerator {
  static sourceHash(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  generate(domain: string, paths: Record<string, PathItem>): TestSuite {
    const journeys: Journey[] = [];

    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;

      const pathLevelParams = this.readParameters(pathItem.parameters);

      for (const method of HTTP_METHODS) {
        const op = pathItem[method.toLowerCase()] as Operation | undefined;
        if (!op || typeof op !== 'object') continue;

        journeys.push(this.buildJourney(pathKey, method, op, pathLevelParams));
      }
    }

    return {
      id: domain,
      name: domain,
      journeys,
      generatedAt: new Date().toISOString(),
      sourceHash: '',
    };
  }

  /* ---- Journey / Step ------------------------------------------------- */

  private buildJourney(
    pathKey: string,
    method: HttpMethod,
    op: Operation,
    pathLevelParams: Parameter[],
  ): Journey {
    const opParams = this.readParameters(op.parameters);
    const params = this.mergeParameters(pathLevelParams, opParams);

    const queryParams = this.paramsToRecord(params.filter(p => p.in === 'query'));
    const headers = this.paramsToRecord(params.filter(p => p.in === 'header'));
    const payload = this.extractRequestBody(op);
    const expectedStatus = this.pickSuccessStatus(op);

    const name =
      (typeof op.summary === 'string' && op.summary.trim()) ||
      (typeof op.operationId === 'string' && op.operationId.trim()) ||
      `${method} ${pathKey}`;

    const opId =
      (typeof op.operationId === 'string' && op.operationId.trim()) ||
      `${method}_${pathKey}`;

    const id = this.slugify(opId);

    const step: Step = {
      id: `${id}-step`,
      name,
      method,
      path: pathKey,
      expectedStatus,
      assertions: [],
    };
    if (Object.keys(queryParams).length > 0) step.queryParams = queryParams;
    if (Object.keys(headers).length > 0) step.headers = headers;
    if (payload !== undefined) step.payload = payload;

    return {
      id,
      name,
      description:
        (typeof op.description === 'string' && op.description.trim()) ||
        `${method} ${pathKey}`,
      steps: [step],
      extractions: [],
    };
  }

  /* ---- Parameters ----------------------------------------------------- */

  private readParameters(raw: unknown): Parameter[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is Parameter => !!p && typeof p === 'object');
  }

  /** Op-level parameters override path-level ones with the same name+location. */
  private mergeParameters(pathLevel: Parameter[], opLevel: Parameter[]): Parameter[] {
    const key = (p: Parameter) => `${p.name}|${p.in}`;
    const map = new Map<string, Parameter>();
    for (const p of pathLevel) map.set(key(p), p);
    for (const p of opLevel) map.set(key(p), p);
    return [...map.values()];
  }

  private paramsToRecord(params: Parameter[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of params) {
      if (!p.required) continue;
      if (typeof p.name !== 'string') continue;
      const schema = (p.schema as Schema | undefined) ?? {};
      const value = this.synthesize(schema, p.example);
      out[p.name] = this.toStringValue(value);
    }
    return out;
  }

  private toStringValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  }

  /* ---- Request body --------------------------------------------------- */

  private extractRequestBody(op: Operation): Record<string, unknown> | undefined {
    const body = op.requestBody as Record<string, unknown> | undefined;
    const content = body?.content as Record<string, Record<string, unknown>> | undefined;
    if (!content) return undefined;

    const json =
      content['application/json'] ??
      content[Object.keys(content)[0]];
    if (!json) return undefined;

    if (json.example !== undefined && this.isPlainObject(json.example)) {
      return json.example as Record<string, unknown>;
    }

    const examples = json.examples as Record<string, Record<string, unknown>> | undefined;
    if (examples) {
      const first = Object.values(examples)[0];
      if (first && this.isPlainObject(first.value)) {
        return first.value as Record<string, unknown>;
      }
    }

    const schema = json.schema as Schema | undefined;
    if (!schema) return undefined;

    const synthesized = this.synthesize(schema);
    return this.isPlainObject(synthesized)
      ? (synthesized as Record<string, unknown>)
      : undefined;
  }

  /* ---- Schema synthesis ---------------------------------------------- */

  private synthesize(schema: Schema | undefined, parameterExample?: unknown): unknown {
    if (parameterExample !== undefined) return parameterExample;
    if (!schema) return undefined;

    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum[0];
    }

    // Composition keywords: take the first branch.
    const composite =
      (schema.oneOf as Schema[] | undefined) ??
      (schema.anyOf as Schema[] | undefined) ??
      (schema.allOf as Schema[] | undefined);
    if (composite && composite.length > 0) {
      return this.synthesize(composite[0]);
    }

    const type = schema.type as string | string[] | undefined;
    const resolved = Array.isArray(type) ? type[0] : type;

    switch (resolved) {
      case 'object':
        return this.synthesizeObject(schema);
      case 'array':
        return this.synthesizeArray(schema);
      case 'integer':
      case 'number':
        return this.synthesizeNumber(schema);
      case 'boolean':
        return false;
      case 'string':
        return this.synthesizeString(schema);
      default:
        // No type declared — object with properties is the most useful fallback.
        if (schema.properties) return this.synthesizeObject(schema);
        return null;
    }
  }

  private synthesizeObject(schema: Schema): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (!properties) return out;

    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );

    for (const [name, propSchema] of Object.entries(properties)) {
      // Include required fields, plus any property with a concrete hint
      // (example/default/enum) so the scaffold is actually useful to edit.
      const hasHint =
        propSchema.example !== undefined ||
        propSchema.default !== undefined ||
        Array.isArray(propSchema.enum);
      if (!required.has(name) && !hasHint) continue;

      const value = this.synthesize(propSchema);
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  private synthesizeArray(schema: Schema): unknown[] {
    const items = schema.items as Schema | undefined;
    if (!items) return [];
    const item = this.synthesize(items);
    return item === undefined ? [] : [item];
  }

  private synthesizeNumber(schema: Schema): number {
    if (typeof schema.minimum === 'number') return schema.minimum;
    if (typeof schema.maximum === 'number') return schema.maximum;
    return 0;
  }

  private synthesizeString(schema: Schema): string {
    const format = schema.format as string | undefined;
    switch (format) {
      case 'date-time': return new Date(0).toISOString();
      case 'date':      return '1970-01-01';
      case 'email':     return 'user@example.com';
      case 'uuid':      return '00000000-0000-0000-0000-000000000000';
      case 'uri':
      case 'url':       return 'https://example.com';
      case 'password':  return 'changeme';
      default:          return '';
    }
  }

  /* ---- Responses ------------------------------------------------------ */

  private pickSuccessStatus(op: Operation): number {
    const responses = op.responses as Record<string, unknown> | undefined;
    if (!responses) return 200;

    // Prefer 2xx codes in ascending order; fall back to 'default'.
    const successCodes = Object.keys(responses)
      .map(code => ({ code, num: parseInt(code, 10) }))
      .filter(c => !isNaN(c.num) && c.num >= 200 && c.num < 300)
      .sort((a, b) => a.num - b.num);

    if (successCodes.length > 0) return successCodes[0].num;
    return 200;
  }

  /* ---- Utilities ------------------------------------------------------ */

  private isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'op';
  }
}
