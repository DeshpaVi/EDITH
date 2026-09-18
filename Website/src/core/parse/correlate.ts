import type { IvrModel, IntentNode, NluBot, NluModel, ReviewItem, SourceRef } from '../model'
import { emptyCoverage } from '../model'
import type { ConnectParseResult } from './connect'
import type { LexParseResult } from './lex'

/**
 * Join the contact flow to the bot exports.
 *
 * The flow knows which bot it calls and which intent names it branches on. The bot knows
 * what those intents actually say. Neither half is a migration on its own, and every way
 * the join can fail is surfaced rather than guessed.
 */
export function correlate(
  flow: ConnectParseResult,
  lex: LexParseResult[],
  importedAt: string,
): IvrModel {
  const review: ReviewItem[] = [...flow.review, ...lex.flatMap((l) => l.review)]
  const bots = lex.flatMap((l) => l.bots)
  const coverage = emptyCoverage()

  const sources: SourceRef[] = [
    { platform: 'amazon-connect', kind: 'contact-flow', name: flow.sourceName, importedAt },
    ...bots.map((b): SourceRef => ({ platform: 'amazon-lex', kind: 'lex-bot', name: b.name, importedAt })),
  ]

  const intentNodes = Object.values(flow.nodes).filter((n): n is IntentNode => n.kind === 'intent')
  const branchedIntents = new Set<string>()
  const resolvedIntents = new Set<string>()
  const dangling = new Set<string>()

  for (const node of intentNodes) {
    const match = matchBot(node.botRef, bots)

    if (!match) {
      node.resolved = false
      review.push({
        nodeId: node.id,
        reason: bots.length === 0
          ? `This flow hands the conversation to a Lex bot (${short(node.botRef)}) but no bot export was uploaded. Without it the migration carries intent names only — no utterances, slot prompts, slot types, or synonyms. Upload the bot export.`
          : `No uploaded bot matches "${short(node.botRef)}". Upload the export for this bot, or confirm which of the uploaded bots it corresponds to.`,
        severity: 'blocker',
      })
      for (const c of node.cases) { branchedIntents.add(c.intent); dangling.add(c.intent) }
      continue
    }

    node.resolved = true
    const why = HEURISTIC_MATCHES[match.how]
    if (why) {
      review.push({
        nodeId: node.id,
        reason: `Assumed bot "${match.bot.name}" is the one this flow calls (${short(node.botRef)}), because ${why}. The alias ARN was not matched — confirm this is the right bot before trusting the conversational content.`,
        severity: 'warn',
      })
    }

    const defined = new Set(match.bot.intents.map((i) => i.name))
    for (const c of node.cases) {
      branchedIntents.add(c.intent)
      if (defined.has(c.intent)) resolvedIntents.add(c.intent)
      else {
        dangling.add(c.intent)
        review.push({
          nodeId: node.id,
          reason: `The flow branches on intent "${c.intent}", which bot "${match.bot.name}" does not define. Either the export is stale or the branch is dead.`,
          severity: 'warn',
        })
      }
    }
  }

  // Intents the bot defines that the flow never branches on. Possibly dead, possibly
  // reachable another way — not our call to make.
  const orphaned: string[] = []
  for (const bot of bots) {
    for (const intent of bot.intents) {
      if (branchedIntents.has(intent.name)) continue
      if (intent.name === 'FallbackIntent' || intent.name === 'AMAZON.FallbackIntent') continue
      orphaned.push(intent.name)
    }
  }
  if (orphaned.length > 0) {
    review.push({
      nodeId: '(bot)',
      reason: `${orphaned.length} intent(s) defined in the bot are never branched on by this flow: ${orphaned.join(', ')}. They may be dead, or reached from a flow that wasn't uploaded.`,
      severity: 'info',
    })
  }

  const totalIntents = bots.reduce((n, b) => n + b.intents.length, 0)
  coverage.flow = {
    totalActions: flow.totalActions,
    mapped: flow.totalActions - flow.unknown.length,
    unknown: flow.unknown,
  }
  coverage.nlu = {
    totalIntents,
    resolved: resolvedIntents.size,
    orphaned,
    dangling: [...dangling],
  }
  coverage.requiresReview = review

  const nlu: NluModel | undefined = bots.length > 0 ? { bots } : undefined

  return {
    sources,
    entryNodeId: flow.entryNodeId,
    nodes: flow.nodes,
    nlu,
    routing: flow.routing,
    containment: applyBotContainment(flow.containment, bots),
    languages: mergeLanguages(flow.languages, bots),
    coverage,
  }
}

interface BotMatch {
  bot: NluBot
  /** How the match was made — the user needs to know how much to trust it. */
  how: 'exact-ref' | 'exact-name' | 'name-in-arn' | 'only-bot-uploaded'
}

const HEURISTIC_MATCHES: Record<BotMatch['how'], string | null> = {
  'exact-ref': null,
  'exact-name': null,
  'name-in-arn': 'its name appears inside the flow\'s alias ARN',
  'only-bot-uploaded': 'it is the only bot uploaded — no name or ARN evidence links it to this flow',
}

/**
 * Exact ref first, then a name-based fallback. An alias ARN
 * (`arn:aws:lex:…:bot-alias/BOTID/ALIASID`) carries IDs rather than the bot name, so a
 * name match is a heuristic and is always flagged as one.
 */
function matchBot(ref: string, bots: NluBot[]): BotMatch | null {
  if (!ref || bots.length === 0) return null

  const exact = bots.find((b) => b.ref === ref)
  if (exact) return { bot: exact, how: 'exact-ref' }

  const lower = ref.toLowerCase()
  const byName = bots.find((b) => b.name.toLowerCase() === lower)
  if (byName) return { bot: byName, how: 'exact-name' }

  const contained = bots.find((b) => b.name.length > 2 && lower.includes(b.name.toLowerCase()))
  if (contained) return { bot: contained, how: 'name-in-arn' }

  // One flow, one bot, no evidence either way — the common single-bot case. Usable, but
  // it is an assumption, and it is reported as one.
  if (bots.length === 1) return { bot: bots[0], how: 'only-bot-uploaded' }

  return null
}

/** A bot's slot retry counts roll up to the application-level threshold in ACXD. */
function applyBotContainment(
  containment: IvrModel['containment'],
  bots: NluBot[],
): IvrModel['containment'] {
  const retries = bots
    .flatMap((b) => b.intents)
    .flatMap((i) => i.slots)
    .map((s) => s.maxRetries)
    .filter((n): n is number => typeof n === 'number')

  if (retries.length === 0) return containment
  const max = Math.max(...retries)
  return {
    ...containment,
    maxInvalidAttempts: containment.maxInvalidAttempts ?? max,
    repeatOnInvalid: containment.repeatOnInvalid ?? true,
  }
}

function mergeLanguages(flowLanguages: string[], bots: NluBot[]): string[] {
  const out = new Set(flowLanguages)
  for (const b of bots) for (const l of b.locales) out.add(normalizeLocale(l))
  return [...out]
}

/** Lex writes `en_US`; BCP-47 and ACXD want `en-US`. */
function normalizeLocale(locale: string): string {
  return locale.replace('_', '-')
}

function short(ref: string): string {
  return ref.length > 48 ? `…${ref.slice(-44)}` : ref
}
