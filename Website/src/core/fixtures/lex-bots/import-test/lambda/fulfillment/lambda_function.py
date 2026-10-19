"""Fulfillment-only Lambda for PizzaFulfillmentBot (Lex V2, Python 3.12).

Lex calls this once all slots are filled. It builds the confirmation message and closes
the intent as Fulfilled. Message text contains "[fulfillment-lambda]" so a successful
invocation is obvious in the Lex test window.
"""


def close(event, text, state='Fulfilled'):
    intent = event['sessionState']['intent']
    intent['state'] = state
    return {
        'sessionState': {
            'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
            'dialogAction': {'type': 'Close'},
            'intent': intent,
        },
        'messages': [{'contentType': 'PlainText', 'content': text}],
    }


def value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def lambda_handler(event, context):
    print(event)
    intent = event['sessionState']['intent']
    name = intent['name']
    if name == 'OrderPizza':
        return close(event, f"[fulfillment-lambda] Order placed: {value(intent, 'quantity')} x "
                            f"{value(intent, 'size')} {value(intent, 'topping')} pizza. Thank you!")
    if name == 'CheckOrderStatus':
        return close(event, f"[fulfillment-lambda] Order {value(intent, 'orderNumber')} is out for delivery.")
    return close(event, f"[fulfillment-lambda] Unhandled intent {name}.", 'Failed')
