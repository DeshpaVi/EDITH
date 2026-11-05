"""Fulfillment Lambda for hotel_food_order_bot (Lex V2, Python 3.12) backed by DynamoDB.

  OrderFood -> writes a PLACED row (new order id "HF" + 6 digits) and replies with the order id and
               the expected time, both read back from the stored row.

Expected time = now + prep minutes for the item (+5 min per extra unit), shown as "about N minutes
(around HH:MM)" in TIMEZONE (default UTC).

Env: TABLE_NAME (default "hotel_orders"), TIMEZONE (default "UTC", e.g. "Asia/Kolkata").
IAM: dynamodb:PutItem on the table. Table key: orderId (String).
DialogCodeHook invocations are answered with Delegate; only FulfillmentCodeHook places an order.
Replies carry "[hotel-lambda]" so a successful invocation is obvious.
"""
import datetime
import os
import random
import zoneinfo

import boto3

TABLE_NAME = os.environ.get('TABLE_NAME', 'hotel_orders').strip()
TIMEZONE = os.environ.get('TIMEZONE', 'UTC').strip()
# Keep in sync with the FoodItem slot type and q-knowledge/hotel-menu.txt
PREP_MINUTES = {'pizza': 25, 'burger': 15, 'noodles': 15, 'fried rice': 15,
                'pasta': 20, 'sandwich': 10, 'salad': 10, 'soup': 10}
EXTRA_UNIT_MINUTES = 5
_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource('dynamodb').Table(TABLE_NAME)
    return _table


def err_code(e):
    return getattr(e, 'response', {}).get('Error', {}).get('Code')


def slot_value(intent, slot):
    s = (intent.get('slots') or {}).get(slot)
    return s['value']['interpretedValue'] if s and s.get('value') else None


def place_order(item, quantity, room):
    now = datetime.datetime.now(datetime.timezone.utc)
    minutes = PREP_MINUTES.get(item, 20) + EXTRA_UNIT_MINUTES * (quantity - 1)
    eta = now + datetime.timedelta(minutes=minutes)
    for _ in range(5):
        row = {'orderId': f'HF{random.randint(100000, 999999)}', 'foodItem': item, 'quantity': quantity,
               'roomNumber': room, 'status': 'PLACED', 'expectedMinutes': minutes,
               'expectedAtUtc': eta.isoformat(timespec='minutes'), 'createdAt': now.isoformat(timespec='seconds')}
        try:
            table().put_item(Item=row, ConditionExpression='attribute_not_exists(orderId)')
            return row
        except Exception as e:  # noqa: BLE001 - boto ClientError, matched by code
            if err_code(e) != 'ConditionalCheckFailedException':
                raise
    raise RuntimeError('could not allocate a unique order id')


def local_time(iso_utc):
    return datetime.datetime.fromisoformat(iso_utc).astimezone(zoneinfo.ZoneInfo(TIMEZONE)).strftime('%H:%M')


def close(event, text, state='Fulfilled'):
    intent = event['sessionState']['intent']
    intent['state'] = state
    return {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                             'dialogAction': {'type': 'Close'}, 'intent': intent},
            'messages': [{'contentType': 'PlainText', 'content': f'[hotel-lambda] {text}'}]}


def delegate(event):
    return {'sessionState': {'sessionAttributes': event['sessionState'].get('sessionAttributes') or {},
                             'dialogAction': {'type': 'Delegate'}, 'intent': event['sessionState']['intent']}}


def lambda_handler(event, context):
    print(event)
    # The console enables the dialog code hook on intents/slots when a Lambda is attached to the alias.
    # Those calls arrive with invocationSource DialogCodeHook: let Lex continue; only fulfil on fulfilment.
    if event.get('invocationSource') == 'DialogCodeHook':
        return delegate(event)
    intent = event['sessionState']['intent']
    try:
        if intent['name'] != 'OrderFood':
            return close(event, f"Unhandled intent {intent['name']}.", 'Failed')
        item = (slot_value(intent, 'foodItem') or '').lower()
        quantity = int(float(slot_value(intent, 'quantity') or 1))
        room = slot_value(intent, 'roomNumber')
        if item not in PREP_MINUTES or not 1 <= quantity <= 20:
            return close(event, 'Sorry, I could not place that order. Please pick a menu item and 1-20 portions.',
                         'Failed')
        row = place_order(item, quantity, room)
        return close(event, f"Your order {row['orderId']} for {row['quantity']} x {row['foodItem']} to room "
                            f"{row['roomNumber']} is confirmed. Expected in about {row['expectedMinutes']} "
                            f"minutes (around {local_time(row['expectedAtUtc'])}).")
    except Exception as e:  # noqa: BLE001
        print('error', repr(e))
        return close(event, 'Sorry, I could not reach the order system. Please try again.', 'Failed')
