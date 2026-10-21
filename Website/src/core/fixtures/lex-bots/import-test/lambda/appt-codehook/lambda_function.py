"""Dialog + fulfillment Lambda for appointment_codehook_bot (Lex V2, Python 3.12) backed by DynamoDB.

  DialogCodeHook (each turn):
    BookAppointment   -> validate service, date (not in the past) and time (08:00-16:59); re-elicit a
                         bad slot, otherwise Delegate so Lex asks for the next one.
    CancelAppointment -> once a number is given, look it up; re-elicit if it does not exist or is
                         already cancelled, so the caller never "cancels" something that isn't there.
  FulfillmentCodeHook:
    BookAppointment   -> write a BOOKED row (new 6-digit appointmentId); confirm with the stored values.
    CancelAppointment -> flip the row to CANCELLED; confirm with the stored service/date/time.

Env: TABLE_NAME (default "appointments"). IAM: dynamodb:PutItem, GetItem, UpdateItem on the table.
Replies carry "[codehook-lambda]" so invocation is obvious in the Lex test window.
"""
import datetime
import os
import random

import boto3

TABLE_NAME = os.environ.get('TABLE_NAME', 'appointments')
SOURCE = 'codehook-bot'
_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource('dynamodb').Table(TABLE_NAME)
    return _table


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def err_code(e):
    return getattr(e, 'response', {}).get('Error', {}).get('Code')


def book(service, day, time):
    """Insert a BOOKED row under a fresh 6-digit appointment number; return the stored item."""
    for _ in range(5):
        item = {'appointmentId': str(random.randint(100000, 999999)), 'serviceType': service,
                'appointmentDate': day, 'appointmentTime': time, 'status': 'BOOKED',
                'createdAt': now(), 'source': SOURCE}
        try:
            table().put_item(Item=item, ConditionExpression='attribute_not_exists(appointmentId)')
            return item
        except Exception as e:  # noqa: BLE001 - boto ClientError, matched by code
            if err_code(e) != 'ConditionalCheckFailedException':
                raise
    raise RuntimeError('could not allocate a unique appointment number')


def get(appointment_id):
    return table().get_item(Key={'appointmentId': str(appointment_id)}, ConsistentRead=True).get('Item')


def cancel(appointment_id):
    """BOOKED -> CANCELLED; returns the updated item, or None if it was not BOOKED."""
    try:
        return table().update_item(
            Key={'appointmentId': str(appointment_id)},
            UpdateExpression='SET #s = :c, cancelledAt = :t',
            ConditionExpression='#s = :b',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':c': 'CANCELLED', ':b': 'BOOKED', ':t': now()},
            ReturnValues='ALL_NEW')['Attributes']
    except Exception as e:  # noqa: BLE001
        if err_code(e) == 'ConditionalCheckFailedException':
            return None
        raise

SERVICES = {'checkup', 'cleaning', 'consultation'}


def slot_value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def describe(item):
    return f"{item['serviceType']} on {item['appointmentDate']} at {item['appointmentTime']}"


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
        out['messages'] = [{'contentType': 'PlainText', 'content': f'[codehook-lambda] {text}'}]
    return out


def invalid(event, slot, text):
    event['sessionState']['intent']['slots'][slot] = None
    return response(event, 'ElicitSlot', text, slot=slot)


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
                if not 8 <= int(tm.split(':')[0]) < 17:
                    return invalid(event, 'appointmentTime', 'We are open 8am to 5pm. What time works?')
            except ValueError:
                return invalid(event, 'appointmentTime', 'I could not read that time. What time works?')
    elif intent['name'] == 'CancelAppointment':
        number = slot_value(intent, 'confirmationNumber')
        if number:
            item = get(number) if number.isdigit() else None
            if not item:
                return invalid(event, 'confirmationNumber',
                               f'I could not find appointment {number}. Please repeat the number.')
            if item.get('status') != 'BOOKED':
                return invalid(event, 'confirmationNumber',
                               f'Appointment {number} is already cancelled. Is there another number?')
    return response(event, 'Delegate')


def fulfill(event):
    intent = event['sessionState']['intent']
    if intent['name'] == 'BookAppointment':
        item = book(slot_value(intent, 'serviceType'), slot_value(intent, 'appointmentDate'),
                    slot_value(intent, 'appointmentTime'))
        return response(event, 'Close',
                        f"Booked a {describe(item)}. Your appointment number is {item['appointmentId']}.",
                        'Fulfilled')
    if intent['name'] == 'CancelAppointment':
        number = slot_value(intent, 'confirmationNumber')
        cancelled = cancel(number)
        if not cancelled:
            return response(event, 'Close', f'Appointment {number} could not be cancelled '
                                            f'(not found or already cancelled).', 'Failed')
        return response(event, 'Close', f'Cancelled appointment {number}: {describe(cancelled)}.', 'Fulfilled')
    return response(event, 'Close', f"Unhandled intent {intent['name']}.", 'Failed')


def lambda_handler(event, context):
    print(event)
    try:
        if event.get('invocationSource') == 'DialogCodeHook':
            return dialog(event)
        return fulfill(event)
    except Exception as e:  # noqa: BLE001
        print('error', repr(e))
        return response(event, 'Close', 'Sorry, I could not reach the appointment system. Please try again.',
                        'Failed')
