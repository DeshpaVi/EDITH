#!/usr/bin/env bash
# Builds the website and publishes it to a private S3 bucket behind CloudFront with a login prompt.
# Needs: Node 20+, the AWS CLI, and AWS credentials that may create S3, CloudFront and CloudFormation resources.
# Usage:  SITE_USERNAME=demo SITE_PASSWORD='a-long-password' ./hosting/deploy-site.sh
#         (or run it without them and it asks). Optional: STACK=journeyforge-site AWS_REGION=us-east-1
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${STACK:-journeyforge-site}"
REGION="${AWS_REGION:-us-east-1}"
if [ -z "${SITE_USERNAME:-}" ]; then read -r -p "Login id for the site: " SITE_USERNAME; fi
if [ -z "${SITE_PASSWORD:-}" ]; then read -r -s -p "Password for the site (12+ characters): " SITE_PASSWORD; echo; fi

echo "== Building"
npm ci
npm run build

echo "== Deploying the hosting stack ($STACK, $REGION)"
aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file hosting/site.template.json \
  --parameter-overrides "SiteUsername=$SITE_USERNAME" "SitePassword=$SITE_PASSWORD"

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out SiteBucketName)"; DIST="$(out DistributionId)"; URL="$(out SiteUrl)"

echo "== Uploading dist/ to s3://$BUCKET"
aws s3 sync dist "s3://$BUCKET" --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache" --content-type "text/html"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null

echo "== Done: $URL  (log in as $SITE_USERNAME)"
