export const MAX_TOOL_ROUNDS = 4;

/**
 * What a Tool failure was, for the log: its message, name and HTTP status. logAiEvent
 * redacts keys and tokens from errorMessage and caps its length.
 */
function errorDetails(error) {
  const category = {
    errorMessage: error?.message || String(error),
    errorType: error?.invalid ? "InvalidArguments" : (error?.name ?? "Error"),
  };
  const status = error?.statusCode ?? error?.status;
  if (Number.isInteger(status) && status > 0) category.statusCode = status;
  return category;
}

/**
 * Wraps provider generate() with a capped Tool-use loop. Tool calls and results live only
 * inside one reply: they are never returned or stored (ADR-0003).
 * @param {object} deps
 * @param {Function} deps.generate generate(request) -> { text, toolCalls? }
 * @param {Array<{name, description, parameters, run}>} deps.tools
 * @param {(event: string, details: object) => void} [deps.logEvent]
 */
export function createToolLoop({ generate, tools, logEvent = () => {} }) {
  const toolDefs = tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

  async function runTool(call, requestId) {
    const startedAt = Date.now();
    let output;
    let ok = true;
    let failure;
    try {
      const tool = tools.find((candidate) => candidate.name === call.name);
      if (call.invalidArgs) throw Object.assign(new Error("invalid arguments"), { invalid: true });
      if (!tool) throw new Error("unknown tool");
      output = await tool.run(call.args ?? {});
    } catch (error) {
      ok = false;
      failure = errorDetails(error);
      output = error?.invalid
        ? `Tool error: ${call.name} received invalid arguments. Tell the member you couldn't check right now; do not guess.`
        : `Tool error: ${call.name} failed${error?.userMessage ? ` (${error.userMessage})` : ""}. Tell the member you couldn't check right now; do not guess.`;
    }
    logEvent("ai_tool_use", {
      requestId,
      tool: call.name,
      durationMs: Date.now() - startedAt,
      ok,
      ...failure,
    });
    return { id: call.id, name: call.name, output };
  }

  return async function generateWithTools(request) {
    // Requests that turn googleSearch off (Compaction) are not replies and get no Tools.
    if (request.googleSearch === false) return generate(request);

    // Usage comes from the first call (system instruction + Turns, no Tool transcript) so
    // Conversation calibration is not inflated by Tool rounds.
    let baseUsage;
    const toolRounds = [];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await generate({ ...request, toolDefs, toolRounds });
      if (round === 0) baseUsage = result.usage;
      if (!result.toolCalls?.length) return { ...result, usage: baseUsage };
      const results = await Promise.all(
        result.toolCalls.map((call) => runTool(call, request.requestId)),
      );
      toolRounds.push({ calls: result.toolCalls, results });
    }
    const last = await generate({ ...request, googleSearch: false, toolRounds });
    return { ...last, usage: baseUsage };
  };
}
