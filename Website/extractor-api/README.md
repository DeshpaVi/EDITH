# Journey extractor API

A Lambda Function URL in front of Amazon Bedrock. The browser sends a customer journey source (text read from a deck
or document, or an image or PDF) and receives structured journey JSON. Model access stays on the server; the prompt and
the output schema are fixed in `contract.mjs`, so the endpoint cannot be used as a general model proxy.

## Deploy

1. Enable model access in Amazon Bedrock for a Claude model that supports tool use and vision in your region, and note its
   model id or inference-profile id. **It is not defaulted: confirm the id yourself.**
2. Generate a long random access token (for example `openssl rand -hex 32`).
3. Package and deploy (from this folder):
   ```bash
   aws cloudformation package --template-file template.json --s3-bucket <YOUR_BUCKET> --output-template-file packaged.json
   aws cloudformation deploy --template-file packaged.json --stack-name journey-extractor --capabilities CAPABILITY_IAM \
     --parameter-overrides ModelId=<MODEL_ID> AllowedOrigin=<https://your-site-or-http://localhost:5173> AccessToken=<TOKEN>
   aws cloudformation describe-stacks --stack-name journey-extractor --query "Stacks[0].Outputs"
   ```
4. In the tool, paste the `ExtractorUrl` output and the access token (or set `VITE_EXTRACTOR_URL`).

## Notes

- Auth is a single shared bearer token, which is enough for a small team demo. Put a real authorizer (for example Cognito
  with a JWT check in front of a Function URL alternative) before exposing it more widely.
- The function logs sizes, status and timing only; never the source, the notes or the token.
- Limits: 400,000 characters of text, about 3.3 MB for an attachment (4.5 million base64 characters).
- `npm run test:extractor` runs the tests (Node's built-in runner, no dependencies).
- Unverified until first deploy: the Bedrock model id you choose, the `InvokedViaFunctionUrl` permission property, and the
  exact Converse tool-use response for your model.
