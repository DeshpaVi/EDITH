#!/usr/bin/env bash
# Builds the website and publishes it to a private S3 bucket behind CloudFront, with a login.
# Needs: Node 20+, the AWS CLI, openssl, and AWS credentials that may create S3, CloudFront, Cognito, Lambda, IAM, SSM and CloudFormation resources.
#
#   Cognito sign-in (default):
#     ADMIN_EMAIL=you@company.com DOMAIN_PREFIX=journeyforge-acme ./hosting/deploy-site.sh
#   Shared username and password (simple, demo only):
#     AUTH=basic SITE_USERNAME=demo SITE_PASSWORD='a-long-password' ./hosting/deploy-site.sh
#
# Optional: STACK (default journeyforge-site), AWS_REGION (default us-east-1), SESSION_HOURS (Cognito, default 8).
# Missing values are asked for. Every Cognito deploy generates a new session key, which signs everyone out once.
set -euo pipefail
cd "$(dirname "$0")/.."

AUTH="${AUTH:-cognito}"
STACK="${STACK:-journeyforge-site}"
REGION="${AWS_REGION:-us-east-1}"
ask() { local v="$1" label="$2" secret="${3:-}"; if [ -z "${!v:-}" ]; then if [ -n "$secret" ]; then read -r -s -p "$label: " "$v"; echo; else read -r -p "$label: " "$v"; fi; fi; }

case "$AUTH" in
  cognito) ask ADMIN_EMAIL "Email of the first user"; ask DOMAIN_PREFIX "Sign-in address prefix (unique, e.g. journeyforge-acme)" ;;
  basic)   ask SITE_USERNAME "Login id for the site"; ask SITE_PASSWORD "Password for the site (12+ characters)" secret ;;
  *) echo "AUTH must be cognito or basic" >&2; exit 1 ;;
esac

echo "== Building"
npm ci
if [ "$AUTH" = "cognito" ]; then VITE_AUTH=cognito npm run build; else npm run build; fi

echo "== Deploying the hosting stack ($STACK, $REGION, $AUTH)"
if [ "$AUTH" = "basic" ]; then
  aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
    --template-file hosting/site.template.json \
    --parameter-overrides "SiteUsername=$SITE_USERNAME" "SitePassword=$SITE_PASSWORD"
else
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  PKG_BUCKET="journeyforge-pkg-$ACCOUNT-$REGION"
  aws s3api head-bucket --bucket "$PKG_BUCKET" 2>/dev/null || aws s3 mb "s3://$PKG_BUCKET" --region "$REGION"
  PACKAGED="$(mktemp)"
  aws cloudformation package --region "$REGION" --template-file hosting/site-cognito.template.json --s3-bucket "$PKG_BUCKET" --output-template-file "$PACKAGED" >/dev/null
  aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file "$PACKAGED" --capabilities CAPABILITY_IAM \
    --parameter-overrides "AdminEmail=$ADMIN_EMAIL" "DomainPrefix=$DOMAIN_PREFIX" "SessionKey=$(openssl rand -hex 24)" "SessionHours=${SESSION_HOURS:-8}"
  rm -f "$PACKAGED"
fi

out() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(out SiteBucketName)"; DIST="$(out DistributionId)"; URL="$(out SiteUrl)"

echo "== Uploading dist/ to s3://$BUCKET"
aws s3 sync dist "s3://$BUCKET" --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp dist/index.html "s3://$BUCKET/index.html" --cache-control "no-cache" --content-type "text/html"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" >/dev/null

echo "== Done: $URL"
if [ "$AUTH" = "cognito" ]; then echo "   Cognito emailed a temporary password to $ADMIN_EMAIL; sign in and choose a new one."; else echo "   Log in as $SITE_USERNAME"; fi
