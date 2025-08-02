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

import { Tools } from "../tools";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

const API_KEY = process.env.UNIFAI_AGENT_API_KEY || "";
const DYNAMIC_TOOLS = process.env.UNIFAI_DYNAMIC_TOOLS !== "false"; // Default to true
const STATIC_TOOLKITS = process.env.UNIFAI_STATIC_TOOLKITS ? process.env.UNIFAI_STATIC_TOOLKITS.split(",").map(id => id.trim()) : null;
const STATIC_ACTIONS = process.env.UNIFAI_STATIC_ACTIONS ? process.env.UNIFAI_STATIC_ACTIONS.split(",").map(id => id.trim()) : null;
const UNVERIFIED_TOOLS = process.env.UNIFAI_UNVERIFIED_TOOLS === "true"; // Default to false

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

const tools = new Tools({ apiKey: API_KEY });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  let toolList = await tools.getTools({
    dynamicTools: DYNAMIC_TOOLS,
    staticToolkits: STATIC_TOOLKITS,
    staticActions: STATIC_ACTIONS,
    unverified: UNVERIFIED_TOOLS,
  });
  
  toolList = toolList.map((tool: any) => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters as ToolInput,
  }));
  
  return { tools: toolList };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await tools.callTool(name, args);
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
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
