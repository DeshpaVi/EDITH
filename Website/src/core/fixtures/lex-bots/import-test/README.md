# Lex import-test bots

Two minimal Lex V2 bots for checking that an export imports cleanly into AWS Lex.
Regenerate with `python3 -I generate.py`.

| Zip | Locales | Intents | Slot types |
|---|---|---|---|
| `PizzaOrderBot.zip` | en_US | OrderPizza, CheckOrderStatus (+Fallback) | custom `PizzaSize`, `PizzaTopping` (with synonyms); `AMAZON.Number`, `AMAZON.AlphaNumeric` |
| `AppointmentBot.zip` | en_US, es_US | BookAppointment, CancelAppointment (+Fallback) | custom `ServiceType` (with synonyms); `AMAZON.Date`, `AMAZON.Time`, `AMAZON.Number` |

Import: Lex console → Bots → Action → Import → upload the zip, pick an IAM runtime role, set the COPPA option, then Build each locale.

Layout and the fallback/prompt-attempt blocks are copied from `../real-lex-v2.json` (a real console export); everything else is written from the Lex V2 docs (`TODO(source-schema)`) and has not yet been confirmed by a real import.

## Lambda test bots (en_US only)

Both are `PizzaOrderBot` with Lambda hooks switched on in the intents. A Lambda is **not** part of a Lex export — after importing, create the function and attach it to the bot alias.

| Bot zip | Lambda zip | Hooks on intents | What the Lambda does |
|---|---|---|---|
| `PizzaFulfillmentBot.zip` | `PizzaFulfillmentLambda.zip` | fulfillment | Closes the intent as Fulfilled with a `[fulfillment-lambda] …` message |
| `PizzaCodeHookBot.zip` | `PizzaCodeHookLambda.zip` | dialog + fulfillment | Validates size/topping/quantity (re-elicits bad values), delegates otherwise, then fulfills with a `[codehook-lambda] …` message |

Setup per bot: Lambda console → Create function (Python 3.12, handler `lambda_function.lambda_handler`) → upload the Lambda zip. In Lex: import the bot zip → build the locale → Aliases → TestBotAlias (or a new alias) → en_US → select the Lambda function. Lex adds invoke permission automatically. Then test in the console, e.g. "order a pizza" → large → cheese → 2. The bracketed prefix in the reply proves the Lambda ran; CloudWatch logs print each event.
