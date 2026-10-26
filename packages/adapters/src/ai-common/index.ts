/**
 * Provider-neutral prompt, schema and estimation surface shared by AI adapters.
 * The Claude adapter remains the original implementation owner for backward compatibility.
 */
export * from "../ai-claude/prompts";
export { approxTokens, outputBudget, shotsOutputBudget } from "../ai-claude/claude-ai";
