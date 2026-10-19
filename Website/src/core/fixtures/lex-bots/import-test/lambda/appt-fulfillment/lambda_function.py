"""Fulfillment-only Lambda for AppointmentFulfillmentBot (Lex V2, Python 3.12).

Lex calls this once all slots are filled; it closes the intent as Fulfilled.
Replies carry "[fulfillment-lambda]" so a successful invocation is obvious.
"""


def value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def close(event, text, state='Fulfilled'):
    intent = event['sessionState']['intent']
    intent['state'] = state
    return {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                             'dialogAction': {'type': 'Close'}, 'intent': intent},
            'messages': [{'contentType': 'PlainText', 'content': text}]}


def lambda_handler(event, context):
    print(event)
    intent = event['sessionState']['intent']
    if intent['name'] == 'BookAppointment':
        return close(event, f"[fulfillment-lambda] Booked a {value(intent, 'serviceType')} on "
                            f"{value(intent, 'appointmentDate')} at {value(intent, 'appointmentTime')}.")
    if intent['name'] == 'CancelAppointment':
        return close(event, f"[fulfillment-lambda] Appointment {value(intent, 'confirmationNumber')} cancelled.")
    return close(event, f"[fulfillment-lambda] Unhandled intent {intent['name']}.", 'Failed')
