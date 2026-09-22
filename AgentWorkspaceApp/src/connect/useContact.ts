/**
 * Binds the workspace bridge to React state.
 *
 * The refresh interval is not decoration. A contact flow can write attributes
 * at any point in the call — an Agentic CX block finishing a data dip, a Lambda
 * writing a CRM case id, an agent-side screen pop updating a status — and the
 * workspace does not push those changes. Reading once at connect time gives the
 * agent a screen that was true when they answered and quietly wrong afterwards.
 */

import { useEffect, useRef, useState } from 'react'
import { config } from '../config/runtime'
import { attributeManifest } from '../config/attributes'
import { selectBridge } from './index'
import type { BridgeError, BridgeHandle, ContactSnapshot } from './types'

export interface ContactView {
  contact: ContactSnapshot | null
  error: BridgeError | null
  /** `mock` means the panel is showing fixture data, not a real call. */
  bridgeKind: 'workspace' | 'mock'
  /** True until the bridge has reported once — distinguishes "loading" from "no contact". */
  connecting: boolean
}

export function useContact(): ContactView {
  const [contact, setContact] = useState<ContactSnapshot | null>(null)
  const [error, setError] = useState<BridgeError | null>(null)
  const [connecting, setConnecting] = useState(true)
  const handleRef = useRef<BridgeHandle | null>(null)
  const bridge = useRef(selectBridge()).current
  const declaredKeys = useRef(
    attributeManifest.groups.flatMap((group) => group.attributes.map((a) => a.key)),
  ).current

  useEffect(() => {
    let disposed = false

    void bridge
      .connect({
        onContactChange: (snapshot) => {
          if (disposed) return
          setConnecting(false)
          setContact(snapshot)
          // A contact arriving clears a stale "not embedded" style error.
          if (snapshot) setError(null)
        },
        onError: (bridgeError) => {
          if (disposed) return
          setConnecting(false)
          setError(bridgeError)
        },
      }, { fallbackAttributeKeys: declaredKeys })
      .then((handle) => {
        if (disposed) {
          handle.close()
          return
        }
        handleRef.current = handle
      })
      .catch((cause: unknown) => {
        if (disposed) return
        setConnecting(false)
        setError({
          kind: 'sdk-call-failed',
          message: cause instanceof Error ? cause.message : 'The workspace bridge failed to start.',
          cause,
        })
      })

    const interval = setInterval(() => {
      void handleRef.current?.refresh()
    }, config.attributeRefreshMs)

    return () => {
      disposed = true
      clearInterval(interval)
      handleRef.current?.close()
      handleRef.current = null
    }
  }, [bridge, declaredKeys])

  return { contact, error, bridgeKind: bridge.kind, connecting }
}
