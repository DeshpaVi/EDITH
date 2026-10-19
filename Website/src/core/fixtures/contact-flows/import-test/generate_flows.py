"""Generates two simple Amazon Connect contact flows that invoke the appointment Lex bots.

  appointment_fulfillment_flow.json -> bot appointment_fulfillment_bot
  appointment_codehook_flow.json    -> bot appointment_codehook_bot

Flow: greeting -> Get customer input (Lex) -> BookAppointment / CancelAppointment -> goodbye -> disconnect
      no match / error -> sorry message -> disconnect

The Lex alias ARN depends on your account, so pass it per bot (find BOT_ID and ALIAS_ID in the
Lex console; TestBotAlias is usually TSTALIASID):

  python3 -I generate_flows.py REGION ACCOUNT_ID FULFILLMENT_BOT_ID FULFILLMENT_ALIAS_ID \\
                               CODEHOOK_BOT_ID CODEHOOK_ALIAS_ID

With no arguments, syntactically valid placeholders are written; re-select the bot and alias in
the Get customer input block after import.

TODO(source-schema): block parameter names follow the Connect flow language docs and the
repo's lex-backed.json fixture; not yet confirmed by importing into a live instance.
"""
import json, os, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NS = uuid.UUID('6f1c2d3e-0000-4000-8000-00000000e117')


def uid(flow, key):
    return str(uuid.uuid5(NS, f'{flow}/{key}'))


def build(flow_name, desc, alias_arn):
    i = lambda k: uid(flow_name, k)
    ids = {k: i(k) for k in ('lang', 'greet', 'lex', 'bye', 'sorry', 'end')}
    a = []
    a.append({'Parameters': {'LanguageCode': 'en-US'}, 'Identifier': ids['lang'],
              'Type': 'UpdateContactData',
              'Transitions': {'NextAction': ids['greet'],
                              'Errors': [{'NextAction': ids['greet'], 'ErrorType': 'NoMatchingError'}]}})
    a.append({'Parameters': {'Text': 'Welcome. I can help you book or cancel an appointment.'},
              'Identifier': ids['greet'], 'Type': 'MessageParticipant',
              'Transitions': {'NextAction': ids['lex'],
                              'Errors': [{'NextAction': ids['lex'], 'ErrorType': 'NoMatchingError'}]}})
    a.append({'Parameters': {'Text': 'How can I help you today?',
                             'LexV2Bot': {'AliasArn': alias_arn}},
              'Identifier': ids['lex'], 'Type': 'GetParticipantInput',
              'Transitions': {
                  'NextAction': ids['sorry'],
                  'Conditions': [
                      {'NextAction': ids['bye'], 'Condition': {'Operator': 'Equals', 'Operands': ['BookAppointment']}},
                      {'NextAction': ids['bye'], 'Condition': {'Operator': 'Equals', 'Operands': ['CancelAppointment']}}],
                  'Errors': [{'NextAction': ids['sorry'], 'ErrorType': 'NoMatchingCondition'},
                             {'NextAction': ids['sorry'], 'ErrorType': 'NoMatchingError'}]}})
    a.append({'Parameters': {'Text': 'Thank you. Goodbye.'}, 'Identifier': ids['bye'],
              'Type': 'MessageParticipant',
              'Transitions': {'NextAction': ids['end'],
                              'Errors': [{'NextAction': ids['end'], 'ErrorType': 'NoMatchingError'}]}})
    a.append({'Parameters': {'Text': 'Sorry, I could not help with that. Goodbye.'}, 'Identifier': ids['sorry'],
              'Type': 'MessageParticipant',
              'Transitions': {'NextAction': ids['end'],
                              'Errors': [{'NextAction': ids['end'], 'ErrorType': 'NoMatchingError'}]}})
    a.append({'Parameters': {}, 'Identifier': ids['end'], 'Type': 'DisconnectParticipant', 'Transitions': {}})
    pos = {'lang': (150, 40), 'greet': (400, 40), 'lex': (650, 40), 'bye': (950, 20), 'sorry': (950, 220), 'end': (1200, 120)}
    return {'Version': '2019-10-30', 'StartAction': ids['lang'],
            'Metadata': {'entryPointPosition': {'x': 20, 'y': 40}, 'name': flow_name, 'description': desc,
                         'type': 'contactFlow', 'status': 'published',
                         'ActionMetadata': {ids[k]: {'position': {'x': x, 'y': y}} for k, (x, y) in pos.items()}},
            'Actions': a}


def arn(region, acct, bot, alias):
    return f'arn:aws:lex:{region}:{acct}:bot-alias/{bot}/{alias}'


if __name__ == '__main__':
    r, acct, fb, fa, cb, ca = (sys.argv[1:] + [None] * 6)[:6] if len(sys.argv) == 7 else \
        ('us-east-1', '123456789012', 'FULFILLBOT', 'TSTALIASID', 'CODEHKBOT0', 'TSTALIASID')
    for name, desc, bot_name, b, al in [
        ('appointment_fulfillment_flow', 'Invokes Lex bot appointment_fulfillment_bot (fulfillment Lambda)',
         'appointment_fulfillment_bot', fb, fa),
        ('appointment_codehook_flow', 'Invokes Lex bot appointment_codehook_bot (dialog + fulfillment Lambda)',
         'appointment_codehook_bot', cb, ca)]:
        path = os.path.join(HERE, f'{name}.json')
        json.dump(build(name, desc, arn(r, acct, b, al)), open(path, 'w'), indent=2)
        print('wrote', path)
