#!/usr/bin/env bash
#
# End-to-end deploy. Everything here has a console equivalent in
# docs/CONSOLE-SETUP.md — this script exists so the order is not a matter of
# memory, because three of these steps consume an output of an earlier one.
#
#   hosting stack  ->  app origin + callback URL
#   backend stack  ->  API base URL + Cognito client  (needs the two above)
#   frontend build ->  needs the backend outputs baked in
#   upload         ->  needs the bucket from the hosting stack
#
# Usage:
#   CONNECT_INSTANCE_ID=... COGNITO_PREFIX=acme-acw-handoff ./infra/deploy.sh
set -euo pipefail

APP_NAME="${APP_NAME:-acw-handoff}"
REGION="${AWS_REGION:-$(aws configure get region)}"
: "${CONNECT_INSTANCE_ID:?Set CONNECT_INSTANCE_ID to the Amazon Connect instance UUID}"
: "${COGNITO_PREFIX:?Set COGNITO_PREFIX to a globally unique Cognito domain prefix}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

stack_output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

echo "==> 1/6 hosting stack"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "${APP_NAME}-hosting" \
  --template-file "$HERE/hosting.yaml" \
  --parameter-overrides "AppName=${APP_NAME}" \
  --no-fail-on-empty-changeset

BUCKET="$(stack_output "${APP_NAME}-hosting" BucketName)"
ARTIFACTS_BUCKET="$(stack_output "${APP_NAME}-hosting" ArtifactsBucketName)"
APP_ORIGIN="$(stack_output "${APP_NAME}-hosting" AppOrigin)"
CALLBACK_URL="$(stack_output "${APP_NAME}-hosting" CallbackUrl)"
DISTRIBUTION_ID="$(stack_output "${APP_NAME}-hosting" DistributionId)"
echo "    app origin: $APP_ORIGIN"

echo "==> 2/6 build and upload the Lambda"
(cd "$ROOT/backend" && npm ci --silent && npm run build --silent)
( cd "$ROOT/backend/dist" && zip -q -r ../transcript-lambda.zip . )
LAMBDA_KEY="${APP_NAME}/transcript-lambda-$(date +%s).zip"
aws s3 cp "$ROOT/backend/transcript-lambda.zip" "s3://${ARTIFACTS_BUCKET}/${LAMBDA_KEY}" --region "$REGION"

echo "==> 3/6 backend stack"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "${APP_NAME}-backend" \
  --template-file "$HERE/backend.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "AppName=${APP_NAME}" \
    "ConnectInstanceId=${CONNECT_INSTANCE_ID}" \
    "AllowedOrigin=${APP_ORIGIN}" \
    "CallbackUrl=${CALLBACK_URL}" \
    "CognitoDomainPrefix=${COGNITO_PREFIX}" \
    "LambdaCodeS3Bucket=${ARTIFACTS_BUCKET}" \
    "LambdaCodeS3Key=${LAMBDA_KEY}" \
  --no-fail-on-empty-changeset

API_BASE_URL="$(stack_output "${APP_NAME}-backend" ApiBaseUrl)"
COGNITO_DOMAIN="$(stack_output "${APP_NAME}-backend" CognitoDomain)"
COGNITO_CLIENT_ID="$(stack_output "${APP_NAME}-backend" CognitoClientId)"

echo "==> 4/6 build the frontend against those outputs"
cat > "$ROOT/.env.production.local" <<ENV
VITE_BRIDGE=workspace
VITE_TRANSCRIPT_SOURCE=api
VITE_API_BASE_URL=${API_BASE_URL}
VITE_AUTH_MODE=cognito
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
VITE_COGNITO_SCOPES=openid email profile
VITE_TRANSCRIPT_POLL_MS=3000
VITE_ATTRIBUTE_REFRESH_MS=5000
ENV
(cd "$ROOT" && npm ci --silent && npm run build)

echo "==> 5/6 upload the site"
# Fingerprinted assets first with a long TTL, then the entry point with none,
# so a browser can never pair a new index.html with evicted old assets.
aws s3 sync "$ROOT/dist/assets" "s3://${BUCKET}/assets" \
  --region "$REGION" --cache-control 'public,max-age=31536000,immutable' --delete
aws s3 sync "$ROOT/dist" "s3://${BUCKET}" \
  --region "$REGION" --exclude 'assets/*' --cache-control 'no-cache' --delete

echo "==> 6/6 invalidate the entry point"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths '/index.html' '/auth/callback.html' >/dev/null

cat <<SUMMARY

Done.

  Access URL for the Amazon Connect third-party application:
    ${APP_ORIGIN}/

  Still to do, in the Amazon Connect console (docs/CONSOLE-SETUP.md):
    1. Register the third-party application with that Access URL.
    2. Grant it on the agents' security profile.
    3. Turn on Contact Lens real-time analytics in the contact flow.
    4. Create a Cognito user for each agent, using the email address that
       matches their Amazon Connect username.
SUMMARY
