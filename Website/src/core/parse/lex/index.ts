import type { NluBot, NluIntent, NluSlot, NluSlotType, ReviewItem } from '../../model'
import { type LexV2Files, isRecord, arr, text, firstMessage, isBuiltInSlotType } from './types'

export interface LexParseResult {
  bots: NluBot[]
  review: ReviewItem[]
}

/**
 * Lex export → NluModel bots. Pure: no I/O, no LLM, no network.
 *
 * Accepts a V1 flat JSON object or a V2 path → JSON map (the caller unzips). Never
 * throws; anything unreadable becomes a review item rather than an exception.
 */
export function parseLexExport(input: unknown, sourceName = 'lex-export'): LexParseResult {
  const review: ReviewItem[] = []

  if (!isRecord(input)) {
    review.push({ nodeId: sourceName, reason: 'Lex export is not a readable JSON object.', severity: 'blocker' })
    return { bots: [], review }
  }

  if (isRecord(input.resource)) return parseV1(input.resource, sourceName, review)

  const looksV2 = Object.keys(input).some((k) => k.includes('/') || k === 'Manifest.json')
  if (looksV2) return parseV2(input as LexV2Files, sourceName, review)

  review.push({
    nodeId: sourceName,
    reason: 'Unrecognized Lex export layout: expected a V1 export with a "resource" object, or an unzipped V2 export keyed by file path.',
    severity: 'blocker',
  })
  return { bots: [], review }
}

// ── V2 ────────────────────────────────────────────────────────────────────────

const isJunk = (path: string): boolean =>
  path.startsWith('__MACOSX/') || (path.split('/').pop() ?? '').startsWith('._')

function parseV2(all: LexV2Files, sourceName: string, review: ReviewItem[]): LexParseResult {
  const files: LexV2Files = Object.fromEntries(
    Object.entries(all).filter(([path]) => !isJunk(path)),
  )
  const botFile = Object.keys(files).find((p) => p.endsWith('Bot.json') && !p.endsWith('/._Bot.json'))
  const botJson = botFile ? files[botFile] : undefined
  const botName =
    (isRecord(botJson) ? text(botJson.name) : undefined) ??
    botFile?.split('/')[0] ??
    sourceName

  const locales = new Set<string>()
  const intentsByName = new Map<string, NluIntent>()
  const slotTypes: NluSlotType[] = []
  let confidenceThreshold: number | undefined

  for (const [path, content] of Object.entries(files)) {
    const locale = path.match(/BotLocales\/([^/]+)\//)?.[1]
    if (locale) locales.add(locale)

    if (path.endsWith('BotLocale.json') && isRecord(content)) {
      const t = content.nluConfidenceThreshold
      if (typeof t === 'number') confidenceThreshold ??= t
      continue
    }

    if (path.endsWith('/Intent.json') && isRecord(content)) {
      const name = text(content.name) ?? path.match(/Intents\/([^/]+)\//)?.[1]
      if (!name) continue
      intentsByName.set(name, {
        name,
        utterances: arr(content.sampleUtterances)
          .map((u) => (isRecord(u) ? text(u.utterance) : text(u)))
          .filter((u): u is string => !!u),
        slots: [],
        initialResponse: isRecord(content.initialResponseSetting)
          ? firstMessage(content.initialResponseSetting.initialResponse)
          : undefined,
        confirmationPrompt: isRecord(content.intentConfirmationSetting)
          ? firstMessage(content.intentConfirmationSetting.promptSpecification)
          : undefined,
        declinationResponse: isRecord(content.intentConfirmationSetting)
          ? firstMessage(content.intentConfirmationSetting.declinationResponse)
          : undefined,
        fulfillmentResponses: fulfillmentResponses(content.fulfillmentCodeHook),
        inputContexts: contextNames(content.inputContexts),
        outputContexts: contextNames(content.outputContexts),
        hasConversationPaths: hasPaths(content),
        closingResponse: isRecord(content.intentClosingSetting)
          ? firstMessage(content.intentClosingSetting.closingResponse)
          : undefined,
        fulfillmentHook: hookArn(content.fulfillmentCodeHook),
        // Real V2 exports declare the per-turn hook under initialResponseSetting.codeHook,
        // not as a top-level dialogCodeHook.
        dialogHook: hookArn(content.dialogCodeHook) ?? hookArn(
          isRecord(content.initialResponseSetting) ? content.initialResponseSetting.codeHook : undefined,
        ),
      })
      continue
    }

    if (path.endsWith('/Slot.json') && isRecord(content)) {
      const intentName = path.match(/Intents\/([^/]+)\//)?.[1]
      if (!intentName) continue
      const slot = readV2Slot(content)
      if (!slot) continue
      const intent = intentsByName.get(intentName)
      if (intent) intent.slots.push(slot)
      else intentsByName.set(intentName, { name: intentName, utterances: [], slots: [slot] })
      continue
    }

    if (path.endsWith('/SlotType.json') && isRecord(content)) {
      const name = text(content.name) ?? path.match(/SlotTypes\/([^/]+)\//)?.[1]
      if (!name) continue
      slotTypes.push({
        name,
        builtIn: isBuiltInSlotType(name),
        values: arr(content.slotTypeValues).map((v) => {
          const rec = isRecord(v) ? v : {}
          const sample = isRecord(rec.sampleValue) ? text(rec.sampleValue.value) : undefined
          return {
            value: sample ?? text(rec.value) ?? '',
            synonyms: arr(rec.synonyms)
              .map((s) => (isRecord(s) ? text(s.value) : text(s)))
              .filter((s): s is string => !!s),
          }
        }).filter((v) => v.value),
      })
    }
  }

  const intents = [...intentsByName.values()]
  if (intents.length === 0) {
    review.push({ nodeId: sourceName, reason: 'No intents found in the Lex V2 export. Confirm the ZIP was unzipped with its directory structure intact.', severity: 'blocker' })
  }

  const bot: NluBot = {
    ref: botName,
    name: botName,
    locales: [...locales],
    confidenceThreshold,
    intents,
    slotTypes,
  }
  flagBuiltIns(bot, review)
  flagDialogHooks(bot, review)
  flagConversationPaths(bot, review)
  return { bots: [bot], review }
}

function readV2Slot(content: Record<string, unknown>): NluSlot | null {
  const name = text(content.name)
  if (!name) return null
  const elicitation = isRecord(content.valueElicitationSetting) ? content.valueElicitationSetting : {}
  const promptSpec = elicitation.promptSpecification
  const obfuscation = isRecord(content.obfuscationSetting)
    ? text(content.obfuscationSetting.obfuscationSettingType)
    : undefined

  return {
    name,
    slotType: text(content.slotTypeName) ?? text(content.slotTypeId) ?? 'unknown',
    prompt: firstMessage(promptSpec),
    required: text(elicitation.slotConstraint) === 'Required',
    maxRetries: isRecord(promptSpec) && typeof promptSpec.maxRetries === 'number' ? promptSpec.maxRetries : undefined,
    sensitive: !!obfuscation && obfuscation !== 'None',
  }
}

/** Post-fulfilment success/failure/timeout copy — real caller-facing wording. */
function fulfillmentResponses(hook: unknown): NluIntent['fulfillmentResponses'] {
  if (!isRecord(hook)) return undefined
  const post = hook.postFulfillmentStatusSpecification
  if (!isRecord(post)) return undefined
  const out = {
    success: firstMessage(post.successResponse),
    failure: firstMessage(post.failureResponse),
    timeout: firstMessage(post.timeoutResponse),
  }
  return out.success || out.failure || out.timeout ? out : undefined
}

function contextNames(v: unknown): string[] | undefined {
  const names = arr(v)
    .map((c) => (isRecord(c) ? text(c.name) : text(c)))
    .filter((n): n is string => !!n)
  return names.length > 0 ? names : undefined
}

/**
 * Detect declarative conversation paths. Post-2022 bots express branching through
 * `nextStep`/`conditional` on each setting instead of a Lambda; a non-default dialogAction
 * or any populated conditional means real structure lives here.
 */
function hasPaths(content: Record<string, unknown>): boolean {
  const json = JSON.stringify(content)
  return /"conditional":\s*\{/.test(json) || /"nextStep":\s*\{/.test(json)
}

function hookArn(hook: unknown): string | undefined {
  if (!isRecord(hook)) return undefined
  if (hook.enabled === false || hook.isActive === false) return undefined
  if (hook.enableCodeHookInvocation === true || hook.isActive === true) {
    return text(hook.uri) ?? 'lambda-configured-on-bot-alias'
  }
  // V2 declares the hook as enabled; the Lambda ARN lives on the bot alias, not here.
  return text(hook.uri) ?? (hook.enabled === true ? 'lambda-configured-on-bot-alias' : undefined)
}

// ── V1 ────────────────────────────────────────────────────────────────────────

function parseV1(resource: Record<string, unknown>, sourceName: string, review: ReviewItem[]): LexParseResult {
  const name = text(resource.name) ?? sourceName
  const locale = text(resource.locale)

  const intents: NluIntent[] = arr(resource.intents).map((raw) => {
    const i = isRecord(raw) ? raw : {}
    const fulfillment = isRecord(i.fulfillmentActivity) ? i.fulfillmentActivity : undefined
    const codeHook = fulfillment && isRecord(fulfillment.codeHook) ? fulfillment.codeHook : undefined

    return {
      name: text(i.name) ?? 'UnnamedIntent',
      utterances: arr(i.sampleUtterances).map((u) => text(u)).filter((u): u is string => !!u),
      slots: arr(i.slots).map((raw2) => {
        const s = isRecord(raw2) ? raw2 : {}
        const prompt = s.valueElicitationPrompt
        return {
          name: text(s.name) ?? 'unnamed',
          slotType: text(s.slotType) ?? 'unknown',
          prompt: firstMessage(prompt),
          required: text(s.slotConstraint) === 'Required',
          maxRetries: isRecord(prompt) && typeof prompt.maxAttempts === 'number' ? prompt.maxAttempts : undefined,
          sensitive: s.obfuscationSetting === 'DEFAULT_OBFUSCATION',
        } satisfies NluSlot
      }),
      confirmationPrompt: firstMessage(i.confirmationPrompt),
      closingResponse: firstMessage(i.conclusionStatement),
      fulfillmentHook: codeHook ? text(codeHook.uri) : undefined,
      dialogHook: isRecord(i.dialogCodeHook) ? text(i.dialogCodeHook.uri) : undefined,
    } satisfies NluIntent
  })

  const slotTypes: NluSlotType[] = arr(resource.slotTypes).map((raw) => {
    const st = isRecord(raw) ? raw : {}
    const stName = text(st.name) ?? 'unnamed'
    return {
      name: stName,
      builtIn: isBuiltInSlotType(stName),
      values: arr(st.enumerationValues).map((v) => {
        const ev = isRecord(v) ? v : {}
        return {
          value: text(ev.value) ?? '',
          synonyms: arr(ev.synonyms).map((s) => text(s)).filter((s): s is string => !!s),
        }
      }).filter((v) => v.value),
    }
  })

  const bot: NluBot = {
    ref: name,
    name,
    locales: locale ? [locale] : [],
    intents,
    slotTypes,
  }
  flagBuiltIns(bot, review)
  flagDialogHooks(bot, review)
  flagConversationPaths(bot, review)
  return { bots: [bot], review }
}

// ── Shared review rules ───────────────────────────────────────────────────────

function flagBuiltIns(bot: NluBot, review: ReviewItem[]): void {
  const declared = new Set(bot.slotTypes.map((t) => t.name))
  const builtIns = new Set<string>()
  for (const intent of bot.intents) {
    for (const slot of intent.slots) {
      if (isBuiltInSlotType(slot.slotType) || !declared.has(slot.slotType)) builtIns.add(slot.slotType)
    }
  }
  for (const name of builtIns) {
    if (!isBuiltInSlotType(name)) continue
    review.push({
      nodeId: `${bot.name}:${name}`,
      reason: `Slot type "${name}" is a Lex built-in. Whether ACXD ships an equivalent, and under what name, is not published — the emitter will mark it TODO(acxd-schema) rather than guess.`,
      severity: 'warn',
    })
  }
}

function flagConversationPaths(bot: NluBot, review: ReviewItem[]): void {
  const withPaths = bot.intents.filter((i) => i.hasConversationPaths)
  if (withPaths.length > 0) {
    review.push({
      nodeId: `${bot.name}`,
      reason: `${withPaths.length} intent(s) define declarative conversation paths (${withPaths.map((i) => i.name).join(', ')}). Lex bots created after 2022-08-17 can branch on conditions and set next steps without a Lambda. Those branches are NOT migrated — the intents and their content come across, the paths between turns do not. Rebuild them as ACXD flow structure.`,
      severity: 'warn',
    })
  }
  const contexts = new Set(bot.intents.flatMap((i) => [...(i.inputContexts ?? []), ...(i.outputContexts ?? [])]))
  if (contexts.size > 0) {
    review.push({
      nodeId: `${bot.name}`,
      reason: `The bot uses Lex contexts (${[...contexts].join(', ')}) to gate which intents can be recognised. ACXD has no direct equivalent — the nearest construct is a Context Variable checked in a choice node, which a human needs to wire deliberately.`,
      severity: 'warn',
    })
  }
}

function flagDialogHooks(bot: NluBot, review: ReviewItem[]): void {
  for (const intent of bot.intents) {
    if (!intent.dialogHook) continue
    review.push({
      nodeId: `${bot.name}:${intent.name}`,
      reason: `Intent "${intent.name}" uses a dialog code hook, which runs on every turn. It usually decomposes into several data_request nodes rather than one — a human needs to decide the split.`,
      severity: 'warn',
    })
  }
}
