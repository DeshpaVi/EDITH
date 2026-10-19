"""Dialog + fulfillment Lambda for AppointmentCodeHookBot (Lex V2, Python 3.12).

  * DialogCodeHook      -> validate filled slots (service type, date not in the past,
                           time within 08:00-17:00, confirmation number format); re-elicit
                           an invalid slot, otherwise Delegate so Lex asks for the next one.
  * FulfillmentCodeHook -> close the intent as Fulfilled.
Replies carry "[codehook-lambda]" so invocation is obvious in the Lex test window.
"""
import datetime

SERVICES = {'checkup', 'cleaning', 'consultation'}


def slot_value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def response(event, action, text=None, intent_state=None, slot=None):
    intent = event['sessionState']['intent']
    if intent_state:
        intent['state'] = intent_state
    act = {'type': action}
    if slot:
        act['slotToElicit'] = slot
    out = {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                            'dialogAction': act, 'intent': intent}}
    if text:
        out['messages'] = [{'contentType': 'PlainText', 'content': text}]
    return out


def invalid(event, slot, text):
    event['sessionState']['intent']['slots'][slot] = None
    return response(event, 'ElicitSlot', f'[codehook-lambda] {text}', slot=slot)


def dialog(event):
    intent = event['sessionState']['intent']
    if intent['name'] == 'BookAppointment':
        svc, day, tm = (slot_value(intent, k) for k in ('serviceType', 'appointmentDate', 'appointmentTime'))
        if svc and svc.lower() not in SERVICES:
            return invalid(event, 'serviceType', 'We offer checkup, cleaning or consultation. Which one?')
        if day:
            try:
                if datetime.date.fromisoformat(day) < datetime.date.today():
                    return invalid(event, 'appointmentDate', 'That date is in the past. Which date works?')
            except ValueError:
                return invalid(event, 'appointmentDate', 'I could not read that date. Which date works?')
        if tm:
            try:
                h = int(tm.split(':')[0])
                if not 8 <= h < 17:
                    return invalid(event, 'appointmentTime', 'We are open 8am to 5pm. What time works?')
            except ValueError:
                return invalid(event, 'appointmentTime', 'I could not read that time. What time works?')
    elif intent['name'] == 'CancelAppointment':
        conf = slot_value(intent, 'confirmationNumber')
        if conf and not conf.isdigit():
            return invalid(event, 'confirmationNumber', 'Confirmation numbers are digits only. Please repeat it.')
    return response(event, 'Delegate')


def fulfill(event):
    intent = event['sessionState']['intent']
    if intent['name'] == 'BookAppointment':
        text = (f"[codehook-lambda] Booked a {slot_value(intent, 'serviceType')} on "
                f"{slot_value(intent, 'appointmentDate')} at {slot_value(intent, 'appointmentTime')}.")
    elif intent['name'] == 'CancelAppointment':
        text = f"[codehook-lambda] Appointment {slot_value(intent, 'confirmationNumber')} cancelled."
    else:
        return response(event, 'Close', f"[codehook-lambda] Unhandled intent {intent['name']}.", 'Failed')
    return response(event, 'Close', text, 'Fulfilled')


def lambda_handler(event, context):
    print(event)
    if event.get('invocationSource') == 'DialogCodeHook':
        return dialog(event)
    return fulfill(event)
