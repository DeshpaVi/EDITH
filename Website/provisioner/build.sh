#!/usr/bin/env bash
# Builds the provisioner package (code plus the ACXD SDK) and uploads it to the artifacts bucket that the
# deployer API injects into every generated stack. Run it from a machine with npm and AWS access.
#   BUCKET=my-artifacts KEY=provisioner/v1.zip ./build.sh
# UNTESTED in the repository's CI sandbox: it needs the npm registry and your AWS account.
set -euo pipefail
: "${BUCKET:?set BUCKET}" "${KEY:?set KEY}"
cd "$(dirname "$0")"
rm -rf build && mkdir build
cp index.mjs package.json build/
(cd build && npm install --omit=dev --no-audit --no-fund && zip -qr ../provisioner.zip .)
aws s3 cp provisioner.zip "s3://${BUCKET}/${KEY}"
echo "Uploaded s3://${BUCKET}/${KEY}. Pin the SDK version in package.json before using this for a customer."
