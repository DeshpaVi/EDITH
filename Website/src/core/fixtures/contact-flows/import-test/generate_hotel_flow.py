"""Generates hotel_food_order_flow.json: a simple Connect flow that starts an Amazon Q in Connect
session and hands the contact to the Lex bot hotel_food_order_bot.

  python3 -I generate_hotel_flow.py [REGION ACCOUNT_ID BOT_ID ALIAS_ID ASSISTANT_ID]

Flow: set language -> greeting -> Connect assistant (Q in Connect session) -> Get customer input (Lex)
      -> OrderFood / ShowMenu / QinConnectIntent -> goodbye -> disconnect; no match / error -> apology.

TODO(source-schema): the CreateWisdomSession block and its WisdomAssistantArn parameter are written
from memory of Connect exports and not confirmed; if the import rejects the block, add a "Connect
assistant" block by hand before the Get customer input block and pick your Q in Connect domain.
"""
import json, os, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NS = uuid.UUID('6f1c2d3e-0000-4000-8000-00000000e117')
NAME = 'hotel_food_order_flow'


def build(alias_arn, assistant_arn):
    ids = {k: str(uuid.uuid5(NS, f'{NAME}/{k}')) for k in ('lang', 'greet', 'q', 'lex', 'bye', 'sorry', 'end')}
    err = lambda to: [{'NextAction': to, 'ErrorType': 'NoMatchingError'}]
    a = [
        {'Parameters': {'LanguageCode': 'en-US'}, 'Identifier': ids['lang'], 'Type': 'UpdateContactData',
         'Transitions': {'NextAction': ids['greet'], 'Errors': err(ids['greet'])}},
        {'Parameters': {'Text': 'Welcome to hotel room service.'}, 'Identifier': ids['greet'],
         'Type': 'MessageParticipant', 'Transitions': {'NextAction': ids['q'], 'Errors': err(ids['q'])}},
        {'Parameters': {'WisdomAssistantArn': assistant_arn}, 'Identifier': ids['q'], 'Type': 'CreateWisdomSession',
         'Transitions': {'NextAction': ids['lex'], 'Errors': err(ids['lex'])}},
        {'Parameters': {'Text': 'What would you like? You can order food or ask about the menu.',
                        'LexV2Bot': {'AliasArn': alias_arn}},
         'Identifier': ids['lex'], 'Type': 'GetParticipantInput',
         'Transitions': {
             'NextAction': ids['sorry'],
             'Conditions': [{'NextAction': ids['bye'], 'Condition': {'Operator': 'Equals', 'Operands': [i]}}
                            for i in ('OrderFood', 'ShowMenu', 'QinConnectIntent')],
             'Errors': [{'NextAction': ids['sorry'], 'ErrorType': 'NoMatchingCondition'},
                        {'NextAction': ids['sorry'], 'ErrorType': 'NoMatchingError'}]}},
        {'Parameters': {'Text': 'Thank you. Goodbye.'}, 'Identifier': ids['bye'], 'Type': 'MessageParticipant',
         'Transitions': {'NextAction': ids['end'], 'Errors': err(ids['end'])}},
        {'Parameters': {'Text': 'Sorry, I could not help with that. Goodbye.'}, 'Identifier': ids['sorry'],
         'Type': 'MessageParticipant', 'Transitions': {'NextAction': ids['end'], 'Errors': err(ids['end'])}},
        {'Parameters': {}, 'Identifier': ids['end'], 'Type': 'DisconnectParticipant', 'Transitions': {}},
    ]
    pos = {'lang': (150, 40), 'greet': (400, 40), 'q': (650, 40), 'lex': (900, 40), 'bye': (1200, 20),
           'sorry': (1200, 220), 'end': (1450, 120)}
    return {'Version': '2019-10-30', 'StartAction': ids['lang'],
            'Metadata': {'entryPointPosition': {'x': 20, 'y': 40}, 'name': NAME,
                         'description': 'Invokes Lex bot hotel_food_order_bot with an Amazon Q in Connect session',
                         'type': 'contactFlow', 'status': 'published',
                         'ActionMetadata': {ids[k]: {'position': {'x': x, 'y': y}} for k, (x, y) in pos.items()}},
            'Actions': a}


if __name__ == '__main__':
    r, acct, bot, alias, asst = sys.argv[1:6] if len(sys.argv) == 6 else (
        'us-east-1', '123456789012', 'HOTELBOT01', 'TSTALIASID', '00000000-0000-0000-0000-000000000000')
    flow = build(f'arn:aws:lex:{r}:{acct}:bot-alias/{bot}/{alias}', f'arn:aws:wisdom:{r}:{acct}:assistant/{asst}')
    path = os.path.join(HERE, f'{NAME}.json')
    json.dump(flow, open(path, 'w'), indent=2)
    print('wrote', path)
