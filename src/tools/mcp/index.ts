#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { functionList, Tools } from "../tools";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

const server = new Server(
  {
    name: "unifai-tools",
    version: process.env.npm_package_version || "",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY || "" });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = functionList.map((fn) => ({
    name: fn.name,
    description: fn.description,
    inputSchema: fn.parameters as ToolInput,
  }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await tools.callTool(name, args);
  return {
    content: [{ type: "text", text: `${result}` }],
  };
});

async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
