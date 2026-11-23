# suibot

A Discord bot that plays anime and VTuber characters in text chat.

## Characters and conversations

**Persona**:
A character the bot plays, such as Suisei or Hu Tao. Each one has its own voice, rules, and a command that summons it.
_Avoid_: character prompt, bot personality

**Conversation**:
The remembered exchange between one member and one Persona in one place. It holds its newest Turns word for word plus a running Summary of everything older. Turns folded into the Summary are forgotten. A Conversation ends when the member resets it or after a day of silence.
_Avoid_: chat history, memory, session

**Turn**:
One message in a Conversation, written either by the member or by the Persona.
_Avoid_: exchange, message, entry

**Summary**:
The Persona's notes on the older part of a Conversation: who the member is, what is going on, and what is still open. It is updated, never rewritten from scratch.
_Avoid_: recap, session summary

**Context Window**:
Everything the Persona sees when it replies: its own instructions, the Conversation's Summary, and as many recent Turns as fit within a fixed size.
_Avoid_: prompt, memory, context

**Compaction**:
Folding a Conversation's oldest Turns into its Summary once the Conversation has grown too big for its Context Window.
_Avoid_: summarizing, trimming, pruning

**Tool**:
Something the Persona can look up while writing a reply, such as searching the web or checking the time. Tool use lasts only for that one reply and never becomes part of the Conversation.
_Avoid_: function, skill, plugin, command
