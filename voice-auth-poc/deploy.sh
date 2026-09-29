#!/usr/bin/env bash
# Two-phase deploy. Phase 1 creates the registry; you push the image; phase 2 deploys compute.
# Usage: THRESHOLD_HIGH=... THRESHOLD_LOW=... ./deploy.sh foundation
#        IMAGE_DIGEST_URI=<repo>@sha256:... [CONNECT_INSTANCE_ARN=... KVS_KMS_KEY_ARN=...] ./deploy.sh compute
set -euo pipefail
cd "$(dirname "$0")/infra"
P=${PROJECT_NAME:-voice-auth-poc}
case "${1:-}" in
  foundation)
    : "${THRESHOLD_HIGH:?calibrate on stage-1 audio first}" "${THRESHOLD_LOW:?}"
    aws cloudformation deploy --template-file 01-foundation.yaml --stack-name "$P-foundation" \
      --parameter-overrides ProjectName="$P" ThresholdHigh="$THRESHOLD_HIGH" ThresholdLow="$THRESHOLD_LOW" \
      ${RETENTION_DAYS:+RetentionDays=$RETENTION_DAYS} ;;
  compute)
    : "${IMAGE_DIGEST_URI:?}"
    aws cloudformation deploy --template-file 02-compute-connect.yaml --stack-name "$P-compute" \
      --capabilities CAPABILITY_IAM \
      --parameter-overrides FoundationStackName="$P-foundation" ProjectName="$P" ImageUri="$IMAGE_DIGEST_URI" \
      ${RETENTION_DAYS:+RetentionDays=$RETENTION_DAYS} \
      ${CONNECT_INSTANCE_ARN:+ConnectInstanceArn=$CONNECT_INSTANCE_ARN} \
      ${KVS_KMS_KEY_ARN:+KvsKmsKeyArn=$KVS_KMS_KEY_ARN} ;;
  *) echo "usage: $0 foundation|compute" >&2; exit 2 ;;
esac
