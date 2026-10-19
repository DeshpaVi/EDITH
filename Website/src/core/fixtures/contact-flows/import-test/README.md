# Connect flows for the appointment Lex bots

| Flow | Lex bot | 
|---|---|
| `appointment_fulfillment_flow.json` | `appointment_fulfillment_bot` |
| `appointment_codehook_flow.json` | `appointment_codehook_bot` |

Both: set language en-US → greeting → Get customer input (Lex) → `BookAppointment` / `CancelAppointment` → goodbye → disconnect; no-match or error → apology → disconnect.

**Before importing**, in Connect: Channels → Flows (Amazon Lex) → add each bot's alias (e.g. TestBotAlias) to the instance. The files carry placeholder alias ARNs (`123456789012`, `TSTALIASID`); regenerate with real ones — `python3 -I generate_flows.py REGION ACCOUNT FULFILLMENT_BOT_ID FULFILLMENT_ALIAS_ID CODEHOOK_BOT_ID CODEHOOK_ALIAS_ID` — or re-select the bot and alias in the Get customer input block after import.

Import: Routing → Flows → Create flow → dropdown next to Save → Import flow. Then Save, Publish, and attach to a phone number or use Test chat.
