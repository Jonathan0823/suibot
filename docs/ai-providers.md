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

## Conversation size

`CONVERSATION_TOKEN_BUDGET` (optional, default 8000) is the global token budget for a Conversation's Summary plus recent Turns. Compaction starts at about 80% of it and folds the oldest Turns into the Summary until about 40% is left. Keep it within the smallest context window of any configured model, because provider fallback can switch models mid-Conversation. See ADR-0003.

## Commands

All subcommands are restricted to `AI_ADMIN_USER_IDS` and reply ephemerally.

- `/ai-provider add` creates a Gemini or OpenAI-compatible provider.
- `/ai-provider update` changes its model, endpoint, priority, or encrypted key.
- `/ai-provider list` shows priority, type, model, enabled state, and credential presence only.
- `/ai-provider enable` and `/ai-provider disable` control fallback eligibility.
- `/ai-provider remove` deletes a provider and its encrypted key.
- `/ai-provider test` makes a small provider request and reports only status and latency.
- `/ai-provider set-log-channel` configures the channel for all-provider failure alerts.

The `model` option of `add` and `update` has autocomplete. It suggests up to 25 model ids from the provider's own list, matched case-insensitively anywhere in the id, with `:free` models first. Gemini uses `models.list` (only `generateContent` models, without the `models/` prefix). OpenAI-compatible providers use `GET {base URL}/models`. `update` uses the stored provider; `add` uses the `type`, `base-url` and `api-key` already entered (Gemini uses `API_KEY`). Lists are cached about 10 minutes per provider. A failed or slow fetch yields no suggestions, and non-admins get none. Free text is still accepted; if the id is not in a list that was fetched, the reply warns but saves anyway. Keys and upstream errors are never shown or logged.

Lower priority numbers are tried first. OpenAI-compatible providers use the standard non-streaming `/chat/completions` endpoint. Their base URL may point to a hosted service or a local HTTP endpoint.

Operational logs contain provider/model/status metadata, duration, and request ids. Prompts, responses, API keys, and raw upstream error bodies are not logged. The configured operations channel is notified only when every eligible provider fails, with a cooldown to prevent alert spam.
