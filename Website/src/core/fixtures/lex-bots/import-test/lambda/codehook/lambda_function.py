"""Dialog + fulfillment Lambda for PizzaCodeHookBot (Lex V2, Python 3.12).

Single handler that drives the whole conversation:
  * DialogCodeHook    -> validate each filled slot; re-elicit an invalid one; otherwise Delegate
                         (Lex asks for the next missing slot with its configured prompt).
  * FulfillmentCodeHook -> close the intent as Fulfilled with the final message.
Message text contains "[codehook-lambda]" so invocation is obvious in the Lex test window.
"""
SIZES = {'small', 'medium', 'large'}
TOPPINGS = {'cheese', 'pepperoni', 'mushroom', 'veggie'}


def slot_value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def response(event, action, text=None, intent_state=None, slot=None):
    intent = event['sessionState']['intent']
    if intent_state:
        intent['state'] = intent_state
    action_obj = {'type': action}
    if slot:
        action_obj['slotToElicit'] = slot
    out = {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                            'dialogAction': action_obj, 'intent': intent}}
    if text:
        out['messages'] = [{'contentType': 'PlainText', 'content': text}]
    return out


def invalid(event, slot, text):
    event['sessionState']['intent']['slots'][slot] = None  # clear so Lex re-asks
    return response(event, 'ElicitSlot', f'[codehook-lambda] {text}', slot=slot)


def dialog(event):
    intent = event['sessionState']['intent']
    if intent['name'] == 'OrderPizza':
        size, top, qty = (slot_value(intent, k) for k in ('size', 'topping', 'quantity'))
        if size and size.lower() not in SIZES:
            return invalid(event, 'size', 'Sorry, we only have small, medium or large. Which size?')
        if top and top.lower() not in TOPPINGS:
            return invalid(event, 'topping', 'Sorry, choose cheese, pepperoni, mushroom or veggie.')
        if qty and not (qty.isdigit() and 1 <= int(qty) <= 10):
            return invalid(event, 'quantity', 'You can order between 1 and 10 pizzas. How many?')
    return response(event, 'Delegate')


def fulfill(event):
    intent = event['sessionState']['intent']
    if intent['name'] == 'OrderPizza':
        text = (f"[codehook-lambda] Order placed: {slot_value(intent, 'quantity')} x "
                f"{slot_value(intent, 'size')} {slot_value(intent, 'topping')} pizza. Thank you!")
    elif intent['name'] == 'CheckOrderStatus':
        text = f"[codehook-lambda] Order {slot_value(intent, 'orderNumber')} is out for delivery."
    else:
        return response(event, 'Close', f"[codehook-lambda] Unhandled intent {intent['name']}.", 'Failed')
    return response(event, 'Close', text, 'Fulfilled')


def lambda_handler(event, context):
    print(event)
    if event.get('invocationSource') == 'DialogCodeHook':
        return dialog(event)
    return fulfill(event)
