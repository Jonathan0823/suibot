# AI provider configuration

The bot keeps Gemini's existing `API_KEY` in the deployment environment. Other providers are configured with `/ai-provider` and have their API keys encrypted in PostgreSQL.

## Required environment variables

```dotenv
API_KEY=your-gemini-key
AI_ENCRYPTION_KEY=<32-byte key encoded as base64 or 64 hex characters>
AI_ADMIN_USER_IDS=discord-user-id-1,discord-user-id-2
```

Generate an encryption key with:

```sh
openssl rand -base64 32
```

`AI_ENCRYPTION_KEY` is the master key for database-managed provider credentials. Back it up in the deployment secret manager. If it is lost, encrypted provider keys cannot be recovered. Master-key rotation is not currently supported.

## Commands

All subcommands are restricted to `AI_ADMIN_USER_IDS` and reply ephemerally.

- `/ai-provider add` creates a Gemini or OpenAI-compatible provider.
- `/ai-provider update` changes its model, endpoint, priority, or encrypted key.
- `/ai-provider list` shows priority, type, model, enabled state, and credential presence only.
- `/ai-provider enable` and `/ai-provider disable` control fallback eligibility.
- `/ai-provider remove` deletes a provider and its encrypted key.
- `/ai-provider test` makes a small provider request and reports only status and latency.
- `/ai-provider set-log-channel` configures the channel for all-provider failure alerts.

Lower priority numbers are tried first. OpenAI-compatible providers use the standard non-streaming `/chat/completions` endpoint. Their base URL may point to a hosted service or a local HTTP endpoint.

Operational logs contain provider/model/status metadata, duration, and request ids. Prompts, responses, API keys, and raw upstream error bodies are not logged. The configured operations channel is notified only when every eligible provider fails, with a cooldown to prevent alert spam.
