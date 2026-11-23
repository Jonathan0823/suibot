# Voice uses one realtime Gemini Live model on the free tier

Voice Sessions talk to `gemini-3.8-live`, a single audio-to-audio model that also detects when the Speaker stops talking. We chose it over a chained speech-to-text → LLM → text-to-speech pipeline and over local Silero VAD so that the small VM does almost no audio processing. The cost is less control over each stage and lock-in to one vendor. We use the free tier, which means Google may use the audio to improve its products. That is acceptable because these conversations are not confidential, and it is why audio is only sent from members who have given Voice Consent.

## Consequences

- One Live connection lasts about 10 minutes, so a Voice Session is capped at 10 minutes until session resumption is built.
- The text path's provider fallback does not apply. Voice works only when a Gemini provider is configured.
