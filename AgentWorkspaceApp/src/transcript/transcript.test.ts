import { describe, expect, it } from 'vitest'
import { emptyTranscript, itemTimeLabel, mergePage } from './merge'
import { normalizeChat, normalizeVoice } from './normalize'
import type { TranscriptItem } from './types'

describe('normalizeVoice', () => {
  it('orders on the millisecond offset the voice API provides', () => {
    const page = normalizeVoice({
      Segments: [
        {
          Transcript: {
            Id: 'b',
            ParticipantId: 'p2',
            ParticipantRole: 'CUSTOMER',
            Content: 'second',
            BeginOffsetMillis: 4200,
            EndOffsetMillis: 6000,
            Sentiment: 'NEGATIVE',
          },
        },
      ],
    })
    expect(page.channel).toBe('VOICE')
    expect(page.items).toHaveLength(1)
    const [turn] = page.items
    expect(turn).toMatchObject({ kind: 'turn', sortKey: 4200, offsetMillis: 4200, sentiment: 'NEGATIVE' })
  })

  it('attaches a matched category to the turn it points at', () => {
    const page = normalizeVoice({
      Segments: [
        {
          Transcript: {
            Id: 'a',
            ParticipantId: 'p1',
            ParticipantRole: 'AGENT',
            Content: 'raising a dispute',
            BeginOffsetMillis: 1000,
            EndOffsetMillis: 2000,
          },
        },
        {
          Categories: {
            MatchedCategories: ['DisputeRaised'],
            MatchedDetails: { DisputeRaised: { PointsOfInterest: [{ BeginOffsetMillis: 1000 }] } },
          },
        },
      ],
    })
    const turn = page.items.find((i) => i.kind === 'turn')
    expect(turn).toMatchObject({ categories: ['DisputeRaised'] })
    // The category segment itself is folded in, not left as a stray item.
    expect(page.items).toHaveLength(1)
  })

  it('keeps a segment type it does not model rather than dropping it', () => {
    const page = normalizeVoice({ Segments: [{ /* an unrecognised shape */ } as never] })
    expect(page.items[0]).toMatchObject({ kind: 'unknown' })
  })

  it('maps an unrecognised participant role to UNKNOWN instead of trusting it', () => {
    const page = normalizeVoice({
      Segments: [
        {
          Transcript: {
            Id: 'a',
            ParticipantId: 'p',
            ParticipantRole: 'SOMETHING_NEW',
            Content: 'hi',
            BeginOffsetMillis: 0,
            EndOffsetMillis: 1,
          },
        },
      ],
    })
    expect(page.items[0]).toMatchObject({ role: 'UNKNOWN' })
  })
})

describe('normalizeChat', () => {
  it('uses the absolute timestamp as the ordering key', () => {
    const page = normalizeChat({
      Channel: 'CHAT',
      Status: 'IN_PROGRESS',
      Segments: [
        {
          Transcript: {
            Id: 'c1',
            ParticipantId: 'p',
            ParticipantRole: 'CUSTOMER',
            Content: 'hello',
            Time: { AbsoluteTime: '2026-09-22T10:00:00.000Z' },
            Redaction: { CharacterOffsets: [{ BeginOffsetChar: 0, EndOffsetChar: 2 }] },
          },
        },
      ],
      NextToken: 'tok',
    })
    expect(page.status).toBe('IN_PROGRESS')
    expect(page.nextToken).toBe('tok')
    expect(page.items[0]).toMatchObject({
      sortKey: Date.parse('2026-09-22T10:00:00.000Z'),
      timestamp: '2026-09-22T10:00:00.000Z',
      redactions: [{ begin: 0, end: 2 }],
    })
  })

  it('models participant events as their own items', () => {
    const page = normalizeChat({
      Segments: [
        { Event: { Id: 'e1', EventType: 'PARTICIPANT_JOINED', Time: { AbsoluteTime: '2026-09-22T10:00:00Z' } } },
      ],
    })
    expect(page.items[0]).toMatchObject({ kind: 'event', eventType: 'PARTICIPANT_JOINED' })
  })
})

describe('mergePage', () => {
  const turn = (id: string, sortKey: number, content: string): TranscriptItem => ({
    kind: 'turn',
    id,
    sortKey,
    role: 'AGENT',
    content,
  })

  it('does not duplicate a segment that a later poll returns again', () => {
    const first = mergePage(emptyTranscript, [turn('a', 0, 'one')])
    const second = mergePage(first, [turn('a', 0, 'one'), turn('b', 10, 'two')])
    expect(second.ordered.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('returns the same object when nothing changed, so React skips the re-render', () => {
    const first = mergePage(emptyTranscript, [turn('a', 0, 'one')])
    expect(mergePage(first, [turn('a', 0, 'one')])).toBe(first)
  })

  it('takes the revised version of a segment that changed', () => {
    const first = mergePage(emptyTranscript, [turn('a', 0, 'partial')])
    const second = mergePage(first, [turn('a', 0, 'partial, now complete')])
    expect(second.ordered).toHaveLength(1)
    expect(second.ordered[0]).toMatchObject({ content: 'partial, now complete' })
  })

  it('sorts out-of-order arrivals by their offset, not by arrival', () => {
    const merged = mergePage(emptyTranscript, [turn('late', 9000, 'later'), turn('early', 100, 'earlier')])
    expect(merged.ordered.map((i) => i.id)).toEqual(['early', 'late'])
  })
})

describe('itemTimeLabel', () => {
  it('renders a voice offset as elapsed call time', () => {
    expect(itemTimeLabel({ kind: 'turn', id: 'a', sortKey: 125000, role: 'AGENT', content: '', offsetMillis: 125000 }))
      .toBe('02:05')
  })
})
