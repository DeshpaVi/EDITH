import { config } from '../config/runtime'
import { mockBridge } from './mockBridge'
import { workspaceBridge } from './workspaceBridge'
import type { WorkspaceBridge } from './types'

export type {
  BridgeError,
  BridgeEvents,
  BridgeHandle,
  Channel,
  ContactSnapshot,
  WorkspaceBridge,
} from './types'

export function selectBridge(): WorkspaceBridge {
  return config.bridge === 'mock' ? mockBridge : workspaceBridge
}
