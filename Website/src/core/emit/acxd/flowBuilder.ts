import { stableId } from './ids'

/**
 * Builds ACXD flow JSON in the shape confirmed by real exports (see the skill's
 * `verified-console-and-export-findings.md`). Only node types and fields confirmed there are produced.
 */

export type NodeType = 'start' | 'basic' | 'escalate' | 'redirect' | 'loop' | 'split' | 'data_request' | 'generative_text' | 'generative_journey'

export type Condition =
  | { left: { type: 'node_status' }; operator: 'eq'; right: { type: 'constant'; value: string } }
  | { operator: 'eq'; left: { type: 'variable'; name: string }; right: { type: 'constant'; value: string | number | boolean } }
  | { left: { type: 'system'; name: 'System.gjConditionIndex' }; operator: 'eq'; right: { type: 'constant'; value: number } }

export const status = (value: 'success' | 'failure' | 'timeout' | 'in_progress' | 'continuation' | 'data_captured'): Condition => ({
  left: { type: 'node_status' },
  operator: 'eq',
  right: { type: 'constant', value },
})
export const variableIs = (name: string, value: string | number | boolean): Condition => ({
  operator: 'eq',
  left: { type: 'variable', name },
  right: { type: 'constant', value },
})
export const exitIndex = (value: number): Condition => ({
  left: { type: 'system', name: 'System.gjConditionIndex' },
  operator: 'eq',
  right: { type: 'constant', value },
})

export type StateModification =
  | { type: 'context'; name: string; modification: 'set'; value: { type: 'constant'; value: string | boolean } }
  | { type: 'slot'; name: string; modification: 'clear' }

export const setContext = (name: string, value: string | boolean): StateModification => ({
  type: 'context',
  name,
  modification: 'set',
  value: { type: 'constant', value },
})
export const clearSlot = (name: string): StateModification => ({ type: 'slot', name, modification: 'clear' })

export interface FlowNode {
  nodeId: string
  childNodes: Array<{ nodeId?: string; name: string; conditions: Condition[] }>
  type: NodeType
  messages: Array<{ body: string; type: 'text' }>
  modalities: Record<string, never>
  metadata: Record<string, unknown> & { stateModifications: StateModification[]; name: string }
  canvasMetadata: { x: number; y: number; width: number; height: number; isMinimized: boolean }
  dataRequests?: unknown[]
}

export interface AttachedSlot {
  name: string
  type: string
  examples: string[]
  sensitive: boolean
  aiDescription: string
  multiSelect: boolean
}

export interface FlowJson {
  flowId: string
  nodes: Record<string, FlowNode>
  description: string
  aiDescription: string
  untrained: boolean
  slotTypes: AttachedSlot[]
  metadata: { path: string; tags: string[] }
  mainLanguageCode: string
  languageCodes: string[]
  mirroring: 'none'
}

export interface NodeOptions {
  messages?: string[]
  stateModifications?: StateModification[]
  /** Type-specific `metadata` entries, for example `{ loop: {...} }`. */
  metadata?: Record<string, unknown>
  dataRequests?: unknown[]
}

export interface FlowOptions {
  description?: string
  aiDescription?: string
  languageCodes?: string[]
  slotTypes?: AttachedSlot[]
}

const NODE_WIDTH = 240
const NODE_HEIGHT = 160
const COLUMN_GAP = 320

export class FlowBuilder {
  private readonly order: string[] = []
  private readonly nodes = new Map<string, FlowNode>()

  constructor(
    readonly flowId: string,
    private readonly options: FlowOptions = {},
  ) {}

  /** Deterministic node id for a key, usable before the node exists. */
  id(key: string): string {
    return stableId(this.flowId, key)
  }

  node(key: string, type: NodeType, opts: NodeOptions = {}): this {
    if (this.nodes.has(key)) throw new Error(`Flow "${this.flowId}": node key "${key}" is used twice`)
    const index = this.order.length
    this.order.push(key)
    const node: FlowNode = {
      nodeId: this.id(key),
      childNodes: [],
      type,
      messages: (opts.messages ?? []).map((body) => ({ body, type: 'text' as const })),
      modalities: {},
      metadata: { stateModifications: opts.stateModifications ?? [], name: '', ...(opts.metadata ?? {}) },
      canvasMetadata: { x: index * COLUMN_GAP, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT, isMinimized: false },
    }
    if (opts.dataRequests) node.dataRequests = opts.dataRequests
    this.nodes.set(key, node)
    return this
  }

  /** Connects `from` to `to`; `to === null` leaves the flow (an exit with no target, as Escalate does). */
  edge(from: string, to: string | null, ...conditions: Condition[]): this {
    const node = this.nodes.get(from)
    if (!node) throw new Error(`Flow "${this.flowId}": unknown source node "${from}"`)
    if (to !== null && !this.nodes.has(to)) throw new Error(`Flow "${this.flowId}": unknown target node "${to}"`)
    node.childNodes.push(to === null ? { name: '', conditions } : { nodeId: this.id(to), name: '', conditions })
    return this
  }

  build(): FlowJson {
    const nodes: Record<string, FlowNode> = {}
    for (const key of this.order) {
      const n = this.nodes.get(key) as FlowNode
      nodes[n.nodeId] = n
    }
    const languageCodes = this.options.languageCodes ?? ['en-US']
    return {
      flowId: this.flowId,
      nodes,
      description: this.options.description ?? '',
      aiDescription: this.options.aiDescription ?? '',
      // Flows that other flows route to by description are trained; internal ones are not.
      untrained: !this.options.aiDescription,
      slotTypes: this.options.slotTypes ?? [],
      metadata: { path: '', tags: [] },
      mainLanguageCode: languageCodes[0],
      languageCodes,
      mirroring: 'none',
    }
  }
}
