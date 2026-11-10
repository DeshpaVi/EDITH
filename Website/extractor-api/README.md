# Journey extractor API

A Lambda Function URL in front of Amazon Bedrock. The browser sends a customer journey source (text read from a deck
or document, or an image or PDF) and receives structured journey JSON. Model access stays on the server; the prompt and
the output schema are fixed in `contract.mjs`, so the endpoint cannot be used as a general model proxy.

## Deploy

1. Enable model access in Amazon Bedrock for a Claude model that supports tool use and vision in your region, and note its
   model id or inference-profile id. **It is not defaulted: confirm the id yourself.**
2. Generate a long random access token (for example `openssl rand -hex 32`).
3. Zip `index.mjs`, `contract.mjs`, `converse.mjs` and `package.json` (at the root of the zip) as `extractor.zip`, upload it to an S3 bucket in the
   stack's region, then deploy `template.json` (console: CloudFormation, Create stack, upload the template; or the CLI):
   ```bash
   aws cloudformation deploy --template-file template.json --stack-name journey-extractor --capabilities CAPABILITY_IAM \
     --parameter-overrides ModelId=<MODEL_ID> AllowedOrigin=<https://your-site> AccessToken=<TOKEN> CodeBucket=<BUCKET_NAME> CodeKey=extractor.zip
   aws cloudformation describe-stacks --stack-name journey-extractor --query "Stacks[0].Outputs"
   ```
4. In the tool, paste the `ExtractorUrl` output and the access token on the Journey page (or build with `VITE_EXTRACTOR_URL` to prefill it).

## Which model

Claude (and Amazon Nova) models accept a forced tool call and images. For other models the extractor adapts: it retries once without a forced tool call if the
model refuses one, accepts a JSON journey in the model's text, ignores reasoning blocks, and tells the user plainly when a model cannot read images or PDFs
(decks, documents and text files still work, because they are read in the browser). If a model rejects tools altogether (the OpenAI open-weight models are not documented to support them), it asks for one JSON object in plain text with the schema in the prompt. `TOOL_CHOICE=auto` or `none` skips the earlier modes from the start; `MAX_TOKENS` raises
the output limit (default 16,000, which reasoning models spend partly on thinking).

## Notes

- Auth is a single shared bearer token, which is enough for a small team demo. Put a real authorizer (for example Cognito
  with a JWT check in front of a Function URL alternative) before exposing it more widely.
- The function logs sizes, status and timing only; never the source, the notes or the token.
- Limits: 400,000 characters of text, about 3.3 MB for an attachment (4.5 million base64 characters).
- `npm run test:extractor` runs the tests (Node's built-in runner, no dependencies).
- Unverified until first deploy: the Bedrock model id you choose, the `InvokedViaFunctionUrl` permission property, and the
  exact Converse tool-use response for your model.
