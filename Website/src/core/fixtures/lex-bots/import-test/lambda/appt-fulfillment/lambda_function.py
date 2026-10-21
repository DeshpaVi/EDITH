"""Fulfillment Lambda for appointment_fulfillment_bot (Lex V2, Python 3.12) backed by DynamoDB.

  BookAppointment   -> writes a BOOKED row (new 6-digit appointmentId) and replies with the
                       values read back from that row, including the appointment number.
  CancelAppointment -> looks the number up in the table, flips status to CANCELLED, and replies
                       with the stored service/date/time. Unknown or already-cancelled numbers
                       are reported as such; nothing is invented.

Env: TABLE_NAME (default "appointments"). IAM: dynamodb:PutItem, GetItem, UpdateItem on the table.
Replies carry "[fulfillment-lambda]" so a successful invocation is obvious.
"""
import datetime
import os
import random

import boto3

TABLE_NAME = os.environ.get('TABLE_NAME', 'appointments')
SOURCE = 'fulfillment-bot'
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


def slot_value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def describe(item):
    return f"{item['serviceType']} on {item['appointmentDate']} at {item['appointmentTime']}"


def close(event, text, state='Fulfilled'):
    intent = event['sessionState']['intent']
    intent['state'] = state
    return {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                             'dialogAction': {'type': 'Close'}, 'intent': intent},
            'messages': [{'contentType': 'PlainText', 'content': f'[fulfillment-lambda] {text}'}]}


def book_appointment(event, intent):
    item = book(slot_value(intent, 'serviceType'), slot_value(intent, 'appointmentDate'),
                slot_value(intent, 'appointmentTime'))
    return close(event, f"Booked a {describe(item)}. Your appointment number is {item['appointmentId']}.")


def cancel_appointment(event, intent):
    number = slot_value(intent, 'confirmationNumber')
    item = get(number)
    if not item:
        return close(event, f'I could not find appointment {number}.', 'Failed')
    if item.get('status') != 'BOOKED':
        return close(event, f"Appointment {number} was already cancelled.", 'Failed')
    cancelled = cancel(number)
    if not cancelled:
        return close(event, f"Appointment {number} was already cancelled.", 'Failed')
    return close(event, f"Cancelled appointment {number}: {describe(cancelled)}.")


def lambda_handler(event, context):
    print(event)
    intent = event['sessionState']['intent']
    try:
        if intent['name'] == 'BookAppointment':
            return book_appointment(event, intent)
        if intent['name'] == 'CancelAppointment':
            return cancel_appointment(event, intent)
        return close(event, f"Unhandled intent {intent['name']}.", 'Failed')
    except Exception as e:  # noqa: BLE001
        print('error', repr(e))
        return close(event, 'Sorry, I could not reach the appointment system. Please try again.', 'Failed')
