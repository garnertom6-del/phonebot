# app.py - a simple AI that answers the phone (cloud version)
import os
from flask import Flask, request
from twilio.twiml.voice_response import VoiceResponse, Gather
import anthropic

# The Anthropic API key is read from a secure environment variable.
# You will set ANTHROPIC_API_KEY in your host's dashboard (Render) - NOT here.
API_KEY = os.environ.get("ANTHROPIC_API_KEY")

app = Flask(__name__)
client = anthropic.Anthropic(api_key=API_KEY)

conversations = {}

SYSTEM_PROMPT = (
    "You are a friendly, concise phone assistant. "
    "Keep replies to 1-2 short sentences, because they will be read aloud. "
    "Speak naturally, like a helpful person answering the phone."
)

@app.route("/voice", methods=["POST"])
def voice():
    response = VoiceResponse()
    gather = Gather(input="speech", action="/respond", speech_timeout="auto")
    gather.say("Hi! Thanks for calling. How can I help you today?")
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
        max_tokens=150,
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
    return "Phone bot is running."

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
