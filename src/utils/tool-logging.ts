import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger";

export function wrapToolHandler<Params extends Record<string, unknown>>(
    toolName: string,
    handler: (params: Params, extra: unknown) => Promise<CallToolResult>,
    logToolCalls: boolean
): (params: Params, extra: unknown) => Promise<CallToolResult> {
    if (!logToolCalls) {
        return handler;
    }

    return async (params: Params, extra: unknown): Promise<CallToolResult> => {
        try {
            logger.debug(`Tool call: ${toolName} args=${JSON.stringify(params)}`);
        } catch (error) {
            logger.debug(`Tool call: ${toolName} args could not be serialized (${error})`);
        }

        return handler(params, extra);
    };
}

