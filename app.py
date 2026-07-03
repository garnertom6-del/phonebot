# app.py - Super Streaming TV phone assistant (cloud version)
import os
from flask import Flask, request
from twilio.twiml.voice_response import VoiceResponse, Gather
import anthropic

from intake import intake_bp

# The Anthropic API key is read from a secure environment variable.
# It is set as ANTHROPIC_API_KEY in your host's dashboard (Render) - NOT here.
API_KEY = os.environ.get("ANTHROPIC_API_KEY")

app = Flask(__name__)
app.register_blueprint(intake_bp)
client = anthropic.Anthropic(api_key=API_KEY)

conversations = {}

SYSTEM_PROMPT = (
    "You are the friendly virtual assistant for Super Streaming TV, a streaming service. "
    "Talk casual and warm, like a helpful buddy - never stiff or corporate. "
    "Keep replies to 1 or 2 short sentences since they are read aloud over the phone, and ask only one question at a time.\n\n"
    "You help callers make payments, reactivate their account, sign up, install the app, and fix problems.\n\n"
    "PAYMENTS AND REACTIVATION:\n"
    "Offer these payment options, in this order:\n"
    "- Zelle to: mtmarrs@live.com\n"
    "- Chime to: $thomas-garner-47\n"
    "- If they don't have Zelle or Chime, Cash App to: $solutions2027\n"
    "When a caller's service is off and they've sent (or are sending) a payment, tell them it takes 10 minutes or less to reactivate. "
    "Then ask for their account name to reactivate them, and let them know they can also text their account number if they know it.\n\n"
    "INSTALLING THE SUPER STREAMING TV APP:\n"
    "First ask what device they are using (Firestick / Fire TV, Android box, etc.) so you give the right steps.\n"
    "If they already have the Downloader app: tell them to open Downloader, type 9014088, and click Go. "
    "The download will be highlighted in blue - click it, choose Download anyway, then Install, then Open.\n"
    "If they don't have Downloader yet (like on a new Firestick): first have them turn on installs - on the Firestick go to Settings, "
    "then My Fire TV (or Device & Software), then Developer Options, and turn ON Apps from Unknown Sources (or Install unknown apps). "
    "Then have them search the Fire TV for the free Downloader app and install it. Once it's installed, open it and use code 9014088 as above.\n\n"
    "TROUBLESHOOTING (keep it simple, one step at a time):\n"
    "- Buffering or freezing: check their internet or wifi and restart the device by unplugging it for 10 seconds.\n"
    "- App won't open or keeps crashing: close and reopen it, or reinstall it with the steps above.\n"
    "- Can't log in: double-check their account name; if still stuck, take their account name so it can be looked into.\n\n"
    "NEW SERVICE / SIGN UP: be welcoming, get their name, and tell them to send a payment using the options above to get started, then you'll get them set up.\n\n"
    "If you can't solve something, stay friendly and offer to have someone follow up - get their name and best callback or text number.\n"
    "Always sound easygoing and upbeat."
)

@app.route("/voice", methods=["POST"])
def voice():
    response = VoiceResponse()
    gather = Gather(input="speech", action="/respond", speech_timeout="auto")
    gather.say("Hey! Thanks for calling Super Streaming TV. I can help you make a payment, get the app set up, or fix an issue - what do you need today?")
    response.append(gather)
    response.redirect("/voice")
    return str(response)

@app.route("/respond", methods=["POST"])
def respond():
    call_sid = request.form.get("CallSid")
    speech = request.form.get("SpeechResult", "")
    response = VoiceResponse()

    if not speech:
        gather = Gather(input="speech", action="/respond", speech_timeout="auto")
        gather.say("Sorry, I didn't catch that. Could you say it again?")
        response.append(gather)
        response.redirect("/voice")
        return str(response)

    history = conversations.get(call_sid, [])
    history.append({"role": "user", "content": speech})

    ai = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=history,
    )
    reply = ai.content[0].text

    history.append({"role": "assistant", "content": reply})
    conversations[call_sid] = history

    gather = Gather(input="speech", action="/respond", speech_timeout="auto")
    gather.say(reply)
    response.append(gather)
    response.redirect("/voice")
    return str(response)

# Simple health check - open the site in a browser to confirm it's alive.
@app.route("/")
def home():
    return 'Phone bot is running. <a href="/intake">Client intake packet</a>'

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
