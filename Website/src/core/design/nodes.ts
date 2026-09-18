import type {
  IvrModel, IvrNode, NluBot, AttachedSlot, PlannedNode, PlannedSlotType,
  PlannedDataRequest, PlannedContextVariable, SchemaGap,
} from '../model'
import {
  stableUuid, slotTypeId, slotName, resourceId, contextVariableName,
  description, choicePayload, lambdaFunctionName,
} from './ids'

export interface FlowBuild {
  startNodeId: string
  nodes: Record<string, PlannedNode>
  attachedSlots: AttachedSlot[]
  slotTypes: PlannedSlotType[]
  dataRequests: PlannedDataRequest[]
  contextVariables: PlannedContextVariable[]
  gaps: SchemaGap[]
}

const uuid = (sourceId: string): string => stableUuid(`node:${sourceId}`)

/**
 * IvrModel nodes → ACXD flow nodes.
 *
 * Deterministic throughout. Where a mapping needs a shape the ACXD docs don't publish —
 * how a `user_choice` binds to its slot type, what goes inside `childNodes[].conditions`,
 * the internals of per-node `metadata` — nothing is invented. The requirement is recorded
 * as a SchemaGap so the emitter writes a TODO(acxd-schema) marker instead.
 */
export function buildFlow(model: IvrModel, languages: string[], mainLanguage: string): FlowBuild {
  const nodes: Record<string, PlannedNode> = {}
  const attachedSlots: AttachedSlot[] = []
  const slotTypes: PlannedSlotType[] = []
  const dataRequests: PlannedDataRequest[] = []
  const contextVariables: PlannedContextVariable[] = []
  const gaps: SchemaGap[] = []
  const bots = model.nlu?.bots ?? []

  const child = (id: string | undefined, name?: string) =>
    id && model.nodes[id] ? [{ nodeId: uuid(id), ...(name ? { name } : {}) }] : []

  // Every flow needs an explicit start node; the IVR's entry action becomes its child.
  const startId = stableUuid('node:__start__')
  nodes[startId] = {
    nodeId: startId,
    type: 'start',
    childNodes: child(model.entryNodeId),
  }

  for (const node of Object.values(model.nodes)) {
    const id = uuid(node.id)
    const planned = mapNode(node, id, child, {
      model, bots, languages, mainLanguage,
      attachedSlots, slotTypes, dataRequests, contextVariables, gaps,
    })
    if (planned) nodes[id] = planned
  }

  return { startNodeId: startId, nodes, attachedSlots, slotTypes, dataRequests, contextVariables, gaps }
}

interface Ctx {
  model: IvrModel
  bots: NluBot[]
  languages: string[]
  mainLanguage: string
  attachedSlots: AttachedSlot[]
  slotTypes: PlannedSlotType[]
  dataRequests: PlannedDataRequest[]
  contextVariables: PlannedContextVariable[]
  gaps: SchemaGap[]
}

type ChildFn = (id: string | undefined, name?: string) => Array<{ nodeId: string; name?: string }>

function mapNode(node: IvrNode, id: string, child: ChildFn, ctx: Ctx): PlannedNode | null {
  const base = { nodeId: id, sourceNodeId: node.id }

  switch (node.kind) {
    case 'prompt':
      return {
        ...base,
        type: 'basic',
        messages: [{ body: node.text, type: 'text' }],
        compliance: node.compliance,
        childNodes: child(node.next),
      }

    case 'menu': {
      const typeId = slotTypeId(`${node.id} Option`)
      ctx.slotTypes.push({
        slotTypeId: typeId,
        description: description(`Menu options migrated from IVR block ${node.id}`),
        // choicePayload carries the original DTMF digit's routing intent.
        values: node.options.map((o) => ({
          value: o.label,
          synonyms: synonymsFor(o.label, ctx.bots),
          choicePayload: choicePayload(o.key),
        })),
        mainLanguageCode: ctx.mainLanguage,
        languageCodes: ctx.languages,
      })
      ctx.attachedSlots.push({
        name: slotName(`${node.id} Choice`),
        type: typeId,
        examples: node.options.map((o) => o.label),
        aiDescription: description(`Which option the caller picked at "${node.prompt}"`),
      })
      ctx.gaps.push({
        marker: 'user_choice ↔ slot type binding',
        what: `How node ${id} binds to slot type "${typeId}", and how choicePayload surfaces at runtime.`,
        needed: 'A GetFlow response for a Canvas-built flow containing a user_choice node.',
        nodeIds: [id],
      })
      return {
        ...base,
        type: 'user_choice',
        messages: [{ body: node.prompt, type: 'text' }],
        childNodes: node.options.flatMap((o) => child(o.next, o.label)),
      }
    }

    case 'intent': {
      const bot = ctx.bots[0]
      for (const c of node.cases) {
        const intent = bot?.intents.find((i) => i.name === c.intent)
        for (const slot of intent?.slots ?? []) {
          const custom = ctx.bots.some((b) => b.slotTypes.some((t) => t.name === slot.slotType && !t.builtIn))
          ctx.attachedSlots.push({
            name: slotName(slot.name),
            // Custom types are created from the bot export; built-ins have no published
            // ACXD equivalent, so they stay visibly unresolved.
            type: custom ? slotTypeId(slot.slotType) : 'TODO_CONFIRM_BUILTIN',
            sensitive: slot.sensitive,
            aiDescription: slot.prompt ? description(slot.prompt) : undefined,
          })
          if (!custom) {
            ctx.gaps.push({
              marker: 'built-in slot type name',
              what: `Slot "${slot.name}" uses type "${slot.slotType}", which the bot does not define as a custom type.`,
              needed: 'Confirm whether ACXD ships an equivalent built-in, or define a custom slot type.',
              nodeIds: [id],
            })
          }
        }
      }
      return {
        ...base,
        type: 'intent_capture',
        messages: [{ body: promptOf(node.id, ctx), type: 'text' }],
        childNodes: node.cases.flatMap((c) => child(c.next, c.intent)),
      }
    }

    case 'capture': {
      const name = slotName(node.variable)
      ctx.attachedSlots.push({
        name,
        type: 'TODO_CONFIRM_BUILTIN',
        sensitive: node.sensitive,
        regex: node.validation?.regex ?? digitRegex(node.validation?.maxLength),
        aiDescription: description(node.prompt),
      })
      ctx.contextVariables.push({
        name: contextVariableName(node.variable),
        schema: { type: 'string', isSensitive: node.sensitive },
        origin: `capture at ${node.id}`,
      })
      ctx.gaps.push({
        marker: 'built-in slot type name',
        what: `Attached slot "${name}" captures digits and needs a numeric/text type.`,
        needed: 'Whether ACXD ships AMAZON.*-style built-ins, and under what names. Otherwise define a custom slot type.',
        nodeIds: [id],
      })
      return {
        ...base,
        type: 'user_input',
        messages: [{ body: node.prompt, type: 'text' }],
        childNodes: child(node.next),
      }
    }

    case 'lookup': {
      const fn = lambdaFunctionName(node.system)
      const requestId = resourceId(fn)
      ctx.dataRequests.push({
        dataRequestId: requestId,
        type: 'object',
        description: description(`Data dip migrated from Lambda ${node.system}`),
        sensitive: false,
        webhook: { implementation: 'external', method: 'POST' },
        sourceSystem: node.system,
      })
      for (const v of node.requestVars) {
        ctx.contextVariables.push({
          name: contextVariableName(v),
          schema: { type: 'string' },
          origin: `request parameter of ${requestId}`,
        })
      }
      return {
        ...base,
        type: 'data_request',
        dataRequests: [requestId],
        childNodes: [...child(node.next, 'success'), ...child(node.onError, 'error')],
      }
    }

    case 'branch':
      ctx.gaps.push({
        marker: 'childNodes[].conditions',
        what: `Branch node ${id} switches on "${node.on}" across ${node.cases.length} case(s); the condition object shape is undocumented.`,
        needed: 'A GetFlow response showing a real choice/split node with populated conditions.',
        nodeIds: [id],
      })
      return {
        ...base,
        type: 'choice',
        childNodes: [
          ...node.cases.flatMap((c) => child(c.next, c.when)),
          ...child(node.default, 'default'),
        ],
      }

    case 'transfer':
      return node.target.type === 'queue'
        ? { ...base, type: 'escalate' }
        : { ...base, type: 'redirect' }

    case 'setVar':
      for (const a of node.assignments) {
        ctx.contextVariables.push({
          name: contextVariableName(a.name),
          schema: { type: 'string' },
          origin: `set at ${node.id}`,
        })
      }
      return { ...base, type: 'define', childNodes: child(node.next) }

    case 'wait':
      return { ...base, type: 'wait', childNodes: child(node.next) }

    case 'loop':
      return {
        ...base,
        type: 'loop',
        childNodes: [...child(node.next, 'iterate'), ...child(node.onComplete, 'complete')],
      }

    case 'end':
      return { ...base, type: 'end' }

    case 'unknown':
      // A `note` node is documentation-only at runtime, which is exactly right: the block
      // stays visible to whoever opens the flow instead of vanishing from the migration.
      return {
        ...base,
        type: 'note',
        messages: [{
          body: `UNMIGRATED: Connect action type "${node.sourceType}" (source id ${node.id}) has no ACXD mapping and must be migrated by hand.`,
          type: 'text',
        }],
        childNodes: child(node.next),
      }
  }
}

/** Reuse synonyms a human already authored in Lex rather than inventing new ones. */
function synonymsFor(label: string, bots: NluBot[]): string[] {
  const target = label.toLowerCase()
  for (const bot of bots) {
    for (const type of bot.slotTypes) {
      const hit = type.values.find((v) => v.value.toLowerCase() === target)
      if (hit && hit.synonyms.length > 0) return hit.synonyms
    }
  }
  return []
}

function promptOf(sourceId: string, ctx: Ctx): string {
  const node = ctx.model.nodes[sourceId]
  return node && node.kind === 'intent' ? 'How can I help you today?' : ''
}

/** Preserve the IVR's digit-length validation rather than relying purely on NLU. */
function digitRegex(maxLength: number | undefined): string | undefined {
  return maxLength ? `^[0-9]{1,${maxLength}}$` : undefined
}
