# Conversations use a fixed budget with batched Compaction, and compacted Turns are discarded

A Conversation's Context Window is one global token budget (about 8k tokens for the Summary plus recent Turns), not a per-provider size. Provider fallback can switch models in the middle of a Conversation, so the context has to fit the smallest configured model. Between Compactions, Turns are only ever added to the end. Compaction starts at about 80% of the budget and folds the oldest Turns into an LLM-written Summary until about 40% is left. This happens in batches rather than as a sliding window, so the start of each request stays the same across many turns and provider prompt caches keep hitting. The cost is one summary call per batch. Turns folded into the Summary are deleted, not archived: no feature needs the full transcript, and keeping one would mean storing members' chat logs indefinitely.

## Consequences

- Never put anything that changes per request (such as the current time) in the system instruction, and never rewrite a stored Turn. Either one breaks the cached prefix.
- Anything a Summary leaves out is lost for good. If the summary call fails and the Conversation reaches 100% of the budget, the oldest Turns are dropped without being summarized.
- Tool calls and their results live only inside one reply and are not stored as Turns.
