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

### Appointment Lambda bots (en_US only)

| Bot zip | Lambda zip | Hooks | Lambda behaviour |
|---|---|---|---|
| `appointment_fulfillment_bot.zip` | `AppointmentFulfillmentLambda.zip` | fulfillment | Books/cancels against DynamoDB (see below); replies with `[fulfillment-lambda] …` |
| `appointment_codehook_bot.zip` | `AppointmentCodeHookLambda.zip` | dialog + fulfillment | Validates slots, checks the appointment exists on cancel, books/cancels against DynamoDB; replies with `[codehook-lambda] …` |

Setup is the same as for the pizza Lambda bots above.

#### DynamoDB-backed appointment Lambdas

Both appointment Lambdas now persist to a table (default name `appointments`, override with env var `TABLE_NAME`; the two bots can share one table — rows carry a `source`).

- Key: `appointmentId` (String). Attributes: `serviceType`, `appointmentDate`, `appointmentTime`, `status` (`BOOKED`/`CANCELLED`), `createdAt`, `cancelledAt`, `source`.
- Book → new 6-digit `appointmentId` (conditional put, retried on collision); the reply is built from the stored row.
- Cancel → row must exist and be `BOOKED`; set to `CANCELLED`; the reply shows the stored service/date/time. Unknown / already-cancelled numbers are reported, never invented. The code-hook bot also checks this during the dialog and re-asks for the number.
- Setup: `aws dynamodb create-table --cli-input-json file://dynamodb/appointments-table.json`; add `dynamodb/lambda-dynamodb-policy.json` (fill in REGION/ACCOUNT_ID) to each Lambda's execution role; set `TABLE_NAME` if you changed the name. Lambda timeout: raise from the 3 s default to ~10 s.

## hotel_food_order_bot (Amazon Q in Connect AI agent + order Lambda)

en_US only. Intents: `OrderFood` (slots foodItem / quantity / roomNumber; fulfillment Lambda), `ShowMenu` (static menu reply), `QinConnectIntent` (`AMAZON.QinConnectIntent`, the Amazon Q in Connect AI agent for free-form questions), plus Fallback. Menu: pizza, burger, noodles, fried rice, pasta, sandwich, salad, soup.

Files: `hotel_food_order_bot.zip`, `HotelFoodOrderLambda.zip` (DynamoDB table `hotel_orders`, key `orderId` String; env `TABLE_NAME`, `TIMEZONE`), `q-knowledge/hotel-menu.txt` (menu document for the Q in Connect knowledge base), and `../../contact-flows/import-test/hotel_food_order_flow.json`.

Setup: create the table and give the Lambda `dynamodb:PutItem`; import and build the bot; set `assistantArn` on `QinConnectIntent` to your Q in Connect assistant (the zip carries a placeholder; regenerate with `ASSISTANT_ARN=... python3 -I generate.py`); attach the Lambda to the alias. **The Q intent only works inside a Connect flow** (the session ARN comes from Connect), so test the whole thing through the flow, not the Lex test window. In the Lex window, OrderFood and ShowMenu work; QinConnectIntent will not answer.

The Q intent's parent signature is `AMAZON.QInConnectIntent` (capital I). The lowercase-i spelling used in the AWS docs page title is rejected by Lex import. Confirmed by a real import of `hotel_food_order_bot.zip`. `hotel_food_order_bot_no_q.zip` is the same bot without the Q intent.
