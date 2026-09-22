import { config } from '../config/runtime'
import { cognitoAuth } from './cognitoPkce'
import { noAuth } from './noAuth'
import type { AuthProvider } from './types'

export type { AuthProvider, AuthState } from './types'

export function selectAuth(): AuthProvider {
  return config.auth === 'cognito' ? cognitoAuth : noAuth
}
