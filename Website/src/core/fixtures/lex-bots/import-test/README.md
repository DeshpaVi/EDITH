# Lex import-test bots

Two minimal Lex V2 bots for checking that an export imports cleanly into AWS Lex.
Regenerate with `python3 -I generate.py`.

| Zip | Locales | Intents | Slot types |
|---|---|---|---|
| `PizzaOrderBot.zip` | en_US | OrderPizza, CheckOrderStatus (+Fallback) | custom `PizzaSize`, `PizzaTopping` (with synonyms); `AMAZON.Number`, `AMAZON.AlphaNumeric` |
| `AppointmentBot.zip` | en_US, es_US | BookAppointment, CancelAppointment (+Fallback) | custom `ServiceType` (with synonyms); `AMAZON.Date`, `AMAZON.Time`, `AMAZON.Number` |

Import: Lex console → Bots → Action → Import → upload the zip, pick an IAM runtime role, set the COPPA option, then Build each locale.

Layout and the fallback/prompt-attempt blocks are copied from `../real-lex-v2.json` (a real console export); everything else is written from the Lex V2 docs (`TODO(source-schema)`) and has not yet been confirmed by a real import.
