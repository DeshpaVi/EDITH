"""Generates two small Lex V2 import-test bots as console-importable ZIPs.

Layout mirrors ../real-lex-v2.json (a real console export):
  <Bot>/Manifest.json
  <Bot>/<Bot>/Bot.json
  <Bot>/<Bot>/BotLocales/<locale>/BotLocale.json
  <Bot>/<Bot>/BotLocales/<locale>/SlotTypes/<Name>/SlotType.json
  <Bot>/<Bot>/BotLocales/<locale>/Intents/<Name>/Intent.json
  <Bot>/<Bot>/BotLocales/<locale>/Intents/<Name>/Slots/<slot>/Slot.json

Run: python3 -I generate.py   (writes the .zip files next to this script)
"""
import copy, hashlib, json, os, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = json.load(open(os.path.join(HERE, '..', 'real-lex-v2.json')))
_P = 'InteractiveMessageBotV2/InteractiveMessageBotV2/BotLocales/en_US/'
FALLBACK = REAL[_P + 'Intents/FallbackIntent/Intent.json']
PROMPT_ATTEMPTS = REAL[_P + 'Intents/InteractiveMessageIntent/Slots/appointment/Slot.json'][
    'valueElicitationSetting']['promptSpecification']['promptAttemptsSpecification']


def ident(*parts):  # deterministic 10-char id, like Lex's
    return hashlib.sha1('|'.join(parts).encode()).hexdigest()[:10].upper()


def msg(text):
    return {'message': {'ssmlMessage': None, 'customPayload': None,
                        'plainTextMessage': {'value': text}, 'imageResponseCard': None},
            'variations': None}


def slot_type(bot, name, desc, values):
    """values: list of (sampleValue, [synonyms])"""
    return {'name': name, 'identifier': ident(bot, name), 'description': desc,
            'slotTypeValues': [{'synonyms': [{'value': s} for s in syn] or None,
                                'sampleValue': {'value': v}} for v, syn in values],
            'parentSlotTypeSignature': None,
            'valueSelectionSetting': {'resolutionStrategy': 'TOP_RESOLUTION', 'regexFilter': None}}


def slot(bot, intent, name, type_name, prompt):
    return {'name': name, 'identifier': ident(bot, intent, name), 'description': None,
            'slotTypeName': type_name,
            'obfuscationSetting': {'obfuscationSettingType': 'None'},
            'valueElicitationSetting': {
                'slotCaptureSetting': None,
                'slotConstraint': 'Required',
                'promptSpecification': {
                    'messageGroupsList': [msg(prompt)], 'maxRetries': 2,
                    'messageSelectionStrategy': 'Random', 'allowInterrupt': True,
                    'promptAttemptsSpecification': copy.deepcopy(PROMPT_ATTEMPTS)},
                'defaultValueSpecification': None, 'sampleUtterances': None,
                'waitAndContinueSpecification': None},
            'multipleValuesSetting': None}


def intent(bot, name, desc, utterances, slots, closing, dialog=False, fulfil=False):
    return {'name': name, 'identifier': ident(bot, name), 'description': desc,
            'parentIntentSignature': None,
            'sampleUtterances': [{'utterance': u} for u in utterances],
            'intentConfirmationSetting': None,
            'intentClosingSetting': None if (dialog or fulfil) else {
                'isActive': True, 'nextStep': None,
                'closingResponse': {'messageGroupsList': [msg(closing)], 'allowInterrupt': True}},
            'initialResponseSetting': None, 'inputContexts': None, 'outputContexts': None,
            'kendraConfiguration': None, 'qnAIntentConfiguration': None,
            'bedrockAgentIntentConfiguration': None,
            'dialogCodeHook': {'enabled': True} if dialog else None,
            'fulfillmentCodeHook': {'enabled': True, 'postFulfillmentStatusSpecification': None,
                                    'fulfillmentUpdatesSpecification': None} if fulfil else None,
            'slotPriorities': [{'priority': i + 1, 'slotName': s[0]} for i, s in enumerate(slots)]}


def fallback(bot, text):
    f = copy.deepcopy(FALLBACK)
    f['identifier'] = ident(bot, 'FallbackIntent')[:10]
    f['intentClosingSetting']['closingResponse']['messageGroupsList'] = [msg(text)]
    return f


def build(bot, desc, locales):
    base = f'{bot}/{bot}/'
    files = {
        f'{bot}/Manifest.json': {'metaData': {'schemaVersion': '1', 'fileFormat': 'LexJson',
                                              'resourceType': 'BOT'}},
        base + 'Bot.json': {'name': bot, 'version': 'DRAFT', 'description': desc,
                            'identifier': ident(bot), 'errorLogSettings': None,
                            'dataPrivacy': {'childDirected': False}, 'idleSessionTTLInSeconds': 300},
    }
    for loc, (label, voice, types, intents, fb) in locales.items():
        lp = base + f'BotLocales/{loc}/'
        files[lp + 'BotLocale.json'] = {'name': label, 'identifier': loc, 'version': None,
                                        'description': None,
                                        'voiceSettings': {'engine': 'standard', 'voiceId': voice},
                                        'nluConfidenceThreshold': 0.4}
        for t in types:
            files[lp + f"SlotTypes/{t['name']}/SlotType.json"] = t
        for i, slots, in intents:
            files[lp + f"Intents/{i['name']}/Intent.json"] = i
            for s in slots:
                files[lp + f"Intents/{i['name']}/Slots/{s['name']}/Slot.json"] = s
        files[lp + 'Intents/FallbackIntent/Intent.json'] = fallback(bot, fb)
    return files


def write_zip(bot, files):
    path = os.path.join(HERE, f'{bot}.zip')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for p, c in files.items():
            z.writestr(p, json.dumps(c, indent=1))
    print('wrote', path, len(files), 'files')


# ── Bot 1: PizzaOrderBot (en_US) ─────────────────────────────────────────────
def pizza_bot(B1, desc, **hooks):
    sizes = slot_type(B1, 'PizzaSize', 'Pizza sizes', [
        ('small', ['personal', 'little']), ('medium', ['regular']), ('large', ['big', 'family'])])
    toppings = slot_type(B1, 'PizzaTopping', 'Pizza toppings', [
        ('cheese', ['plain', 'margherita']), ('pepperoni', []), ('mushroom', ['mushrooms']), ('veggie', ['vegetarian'])])
    order_slots = [slot(B1, 'OrderPizza', 'size', 'PizzaSize', 'What size pizza would you like?'),
                   slot(B1, 'OrderPizza', 'topping', 'PizzaTopping', 'What topping would you like?'),
                   slot(B1, 'OrderPizza', 'quantity', 'AMAZON.Number', 'How many pizzas?')]
    order = intent(B1, 'OrderPizza', 'Place a pizza order',
                   ['I want to order a pizza', 'order a pizza', 'I would like a {size} {topping} pizza',
                    'get me {quantity} {size} pizzas', 'pizza please'],
                   [(s['name'],) for s in order_slots], 'Thanks! Your pizza order has been placed.', **hooks)
    status_slots = [slot(B1, 'CheckOrderStatus', 'orderNumber', 'AMAZON.AlphaNumeric',
                         'What is your order number?')]
    status = intent(B1, 'CheckOrderStatus', 'Check the status of an order',
                    ['where is my order', 'check my order status', 'status of order {orderNumber}',
                     'track my pizza'],
                    [(s['name'],) for s in status_slots], 'Your order is on its way.', **hooks)
    return build(B1, desc, {
        'en_US': ('English (US)', 'Kimberly', [sizes, toppings],
                  [(order, order_slots), (status, status_slots)],
                  "Sorry, I didn't understand that. You can order a pizza or check an order.")})


B1 = 'PizzaOrderBot'
bot1 = pizza_bot(B1, 'Import test bot 1: custom + built-in slot types, 2 intents, 1 locale')
B3 = 'PizzaFulfillmentBot'
bot3 = pizza_bot(B3, 'Import test bot 3: PizzaOrderBot + fulfillment Lambda hook on every intent', fulfil=True)
B4 = 'PizzaCodeHookBot'
bot4 = pizza_bot(B4, 'Import test bot 4: PizzaOrderBot + dialog and fulfillment Lambda hook; the Lambda drives everything',
                 dialog=True, fulfil=True)

# ── Bot 2: AppointmentBot (en_US + es_US) ────────────────────────────────────
B2 = 'AppointmentBot'


def appt_locale(svc_vals, p, u, close_book, close_cancel, fb, svc_name='ServiceType'):
    svc = slot_type(B2, svc_name, 'Type of service', svc_vals)
    book_slots = [slot(B2, 'BookAppointment', 'serviceType', svc_name, p['svc']),
                  slot(B2, 'BookAppointment', 'appointmentDate', 'AMAZON.Date', p['date']),
                  slot(B2, 'BookAppointment', 'appointmentTime', 'AMAZON.Time', p['time'])]
    book = intent(B2, 'BookAppointment', 'Book an appointment', u['book'],
                  [(s['name'],) for s in book_slots], close_book)
    cancel_slots = [slot(B2, 'CancelAppointment', 'confirmationNumber', 'AMAZON.Number', p['conf'])]
    cancel = intent(B2, 'CancelAppointment', 'Cancel an appointment', u['cancel'],
                    [(s['name'],) for s in cancel_slots], close_cancel)
    return [svc], [(book, book_slots), (cancel, cancel_slots)], fb


en = appt_locale(
    [('checkup', ['exam', 'physical']), ('cleaning', ['hygiene']), ('consultation', ['consult'])],
    {'svc': 'What type of appointment do you need?', 'date': 'What date works for you?',
     'time': 'What time would you like?', 'conf': 'What is your confirmation number?'},
    {'book': ['book an appointment', 'I need an appointment', 'schedule a {serviceType}',
              'I would like a {serviceType} on {appointmentDate}',
              'book a {serviceType} at {appointmentTime}'],
     'cancel': ['cancel my appointment', 'I need to cancel', 'cancel appointment {confirmationNumber}']},
    'Your appointment is booked.', 'Your appointment has been cancelled.',
    "Sorry, I didn't catch that. You can book or cancel an appointment.")
es = appt_locale(
    [('revisión', ['chequeo', 'examen']), ('limpieza', []), ('consulta', ['consultar'])],
    {'svc': '¿Qué tipo de cita necesita?', 'date': '¿Qué fecha le conviene?',
     'time': '¿A qué hora le gustaría?', 'conf': '¿Cuál es su número de confirmación?'},
    {'book': ['reservar una cita', 'necesito una cita', 'quiero una {serviceType}',
              'quiero una {serviceType} el {appointmentDate}'],
     'cancel': ['cancelar mi cita', 'necesito cancelar', 'cancelar la cita {confirmationNumber}']},
    'Su cita ha sido reservada.', 'Su cita ha sido cancelada.',
    'Lo siento, no entendí. Puede reservar o cancelar una cita.')
bot2 = build(B2, 'Import test bot 2: synonyms, AMAZON.Date/Time/Number, 2 locales (en_US, es_US)', {
    'en_US': ('English (US)', 'Kimberly', *en[:2], en[2]),
    'es_US': ('Spanish (US)', 'Lupe', *es[:2], es[2])})

if __name__ == '__main__':
    write_zip(B1, bot1)
    write_zip(B2, bot2)
    write_zip(B3, bot3)
    write_zip(B4, bot4)
