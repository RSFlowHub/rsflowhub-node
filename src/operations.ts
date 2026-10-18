import { RSFlowHubError, isRecord } from './errors.js';
import { operations as bundled } from './generated/operations.js';
import type { Transport } from './transport.js';

export type Operation = readonly [method: string, path: string];
export type OperationMap = Record<string, Record<string, Operation>>;

/**
 * Knows which HTTP call each SDK method makes.
 *
 * 1. The bundled map (src/generated/operations.ts), generated from the live
 *    OpenAPI document by scripts/generate.mjs.
 * 2. Not there, AI resource: POST /ai/{method-in-kebab-case}. Every flat AI
 *    endpoint works this way, including ones released after this SDK version.
 * 3. Not there, other resource: read GET /openapi.json once (x-rsflowhub-sdk)
 *    and look again, so new knowledge-base/chatbot routes work too.
 *
 * @internal
 */
export class Operations {
  private map: OperationMap;
  private live: Promise<void> | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly liveSpec: boolean,
  ) {
    this.map = Object.fromEntries(Object.entries(bundled).map(([r, m]) => [r, { ...m }]));
  }

  async find(resource: string, method: string): Promise<Operation> {
    const known = this.map[resource]?.[method];
    if (known) return known;

    if (resource === 'ai') return ['POST', `/ai/${kebab(method)}`];

    if (this.liveSpec) {
      this.live ??= this.loadLiveSpec();
      await this.live;
      const found = this.map[resource]?.[method];
      if (found) return found;
    }

    const methods = Object.keys(this.map[resource] ?? {});
    throw new RSFlowHubError(
      `Unknown RSFlowHub method ${resource}.${method}(). ` +
        (methods.length ? `Known methods: ${methods.join(', ')}. ` : 'Unknown resource. ') +
        'Use client.request() for any other route.',
    );
  }

  private async loadLiveSpec(): Promise<void> {
    try {
      const spec = (await this.transport.send('GET', '/openapi.json')).body;
      for (const [resource, methods] of Object.entries(fromSpec(spec))) {
        this.map[resource] = { ...methods, ...this.map[resource] };
      }
    } catch {
      // offline or older server: keep the bundled map
    }
  }
}

/** Read x-rsflowhub-sdk names out of an OpenAPI document. */
export function fromSpec(spec: Record<string, unknown>): OperationMap {
  const map: OperationMap = {};
  const paths = isRecord(spec.paths) ? spec.paths : {};
  for (const [path, ops] of Object.entries(paths)) {
    if (!isRecord(ops)) continue;
    for (const [httpMethod, op] of Object.entries(ops)) {
      const sdk = isRecord(op) && isRecord(op['x-rsflowhub-sdk']) ? op['x-rsflowhub-sdk'] : null;
      if (!sdk || typeof sdk.resource !== 'string' || typeof sdk.method !== 'string') continue;
      (map[sdk.resource] ??= {})[sdk.method] = [httpMethod.toUpperCase(), path];
    }
  }
  return map;
}

export function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
