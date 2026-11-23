# suibot

A Discord bot that plays anime and VTuber characters in text chat and, soon, in voice channels.

## Characters and conversations

**Persona**:
A character the bot plays, such as Suisei or Hu Tao. Each one has its own voice, rules, and a command that summons it.
_Avoid_: character prompt, bot personality

**Conversation**:
The remembered exchange between one member and one Persona in one place. It holds recent turns plus a running summary.
_Avoid_: chat history, memory, session

## Voice

**Voice Session**:
One stretch of time in which the bot sits in a guild's voice channel and talks aloud as a Persona. A guild has at most one at a time.
_Avoid_: call, voice chat, live session

**Speaker**:
The one member a Voice Session listens to. Nobody else's audio is heard.
_Avoid_: caller, host, active user

**Voice Consent**:
A member's standing agreement that their voice may be sent to the outside speech model.
_Avoid_: opt-in, permission
