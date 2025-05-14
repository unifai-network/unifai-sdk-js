[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/unifai-network-unifai-sdk-js-badge.png)](https://mseep.ai/app/unifai-network-unifai-sdk-js)

# unifai-sdk-js

unifai-sdk-js is the JavaScript/TypeScript SDK for UnifAI, an AI native platform for dynamic tools and agent to agent communication.

## Installation

```bash
npm install unifai-sdk
```

## Getting your UnifAI API key

You can get your API key for free from [UnifAI](https://app.unifai.network/).

There are two types of API keys:

- Agent API key: for using toolkits in your own agents.
- Toolkit API key: for creating toolkits that can be used by other agents.

## Using tools

To use tools in your agents, you need an **agent** API key. You can get an agent API key for free at [UnifAI](https://app.unifai.network/).

```typescript
import { Tools } from 'unifai-sdk';

const tools = new Tools({ apiKey: 'xxx' });
```

### Tool Types

UnifAI provides a flexible system for integrating AI tools in your applications:

#### Dynamic Tools

Dynamic tools are enabled by default, allowing agents to discover and use tools on-the-fly based on the task at hand. Tools will not be visible to agents directly. Instead, agents will see two functions only: one to search tools, one to use tools. Agents will be able to search for tools based on semantic query, get a list of relevant tools, and use tools dynamically.

```typescript
// Enable dynamic tools (default behavior)
const dynamicTools = await tools.getTools({ dynamicTools: true });
```

#### Static Toolkits

Static toolkits allow you to specify entire toolkits to be exposed to agents so they can be used without search.

```typescript
const staticTools = await tools.getTools({
  dynamicTools: false,  // Optional: disable dynamic tools
  staticToolkits: ["1", "2"]
});
```

You can find available toolkits at https://app.unifai.network/toolkits.

#### Static Actions

Static actions provide granular control, allowing you to specify individual actions (tools) to be exposed to agents.

```typescript
const staticTools = await tools.getTools({
  dynamicTools: false,  // Optional: disable dynamic tools
  staticActions: ["action_id_1", "action_id_2"]
});
```

You can find available actions at https://app.unifai.network/actions.

#### Mixed Tools

You can combine these approaches for a customized tool setup:

```typescript
const combinedTools = await tools.getTools({
  dynamicTools: true,
  staticToolkits: ["essential_toolkit_id"],
  staticActions: ["critical_action_id"]
});
```

### Passing Tools to LLMs

You can pass the tools to any OpenAI compatible API. Popular options include:

- Model providers' native API
- [OpenRouter](https://openrouter.ai/docs): A service that gives you access to most LLMs through a single OpenAI compatible API

The tools will work with any API that follows the OpenAI function calling format. This gives you the flexibility to choose the best LLM for your needs while keeping your tools working consistently.

```typescript
const messages = [{ content: "Can you tell me what is trending on Google today?", role: "user" }];
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages,
  tools: await tools.getTools(),
});
```

If the response contains tool calls, you can pass them to the tools.callTools method to get the results. The output will be a list of messages containing the results of the tool calls that can be concatenated to the original messages and passed to the LLM again.

```typescript
const results = await tools.callTools(response.choices[0].message.tool_calls);
messages.push(...results);
// messages can be passed to the LLM again now
```

Passing the tool calls results back to the LLM might get you more function calls, and you can keep calling the tools until you get a response that doesn't contain any tool calls. For example:

```typescript
const messages = [{ content: "Can you tell me what is trending on Google today?", role: "user" }];
while (true) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools: await tools.getTools(),
  });
  messages.push(response.choices[0].message);
  const results = await tools.callTools(response.choices[0].message.tool_calls);
  if (results.length === 0) break;
  messages.push(...results);
}
```

### Using tools in MCP clients

We provide a MCP server to access tools in any [MCP clients](https://modelcontextprotocol.io/clients) such as [Claude Desktop](https://modelcontextprotocol.io/quickstart/user).

Make sure you have npm installed. Then in your MCP client config:

```json
{
  "mcpServers": {
    "unifai": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "unifai-sdk",
        "unifai-tools-mcp"
      ],
      "env": {
        "UNIFAI_AGENT_API_KEY": ""
      }
    }
  }
}
```

Now your MCP client will be able to access all the tools in UnifAI automatically through dynamic tools.

You can use environment variable to choose dynamic/static tools exposed by the MCP server, for example:

```json
{
  "mcpServers": {
    "unifai": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "unifai-sdk",
        "unifai-tools-mcp"
      ],
      "env": {
        "UNIFAI_AGENT_API_KEY": "",
        "UNIFAI_DYNAMIC_TOOLS": "true",
        "UNIFAI_STATIC_TOOLKITS": "1,2,3",
        "UNIFAI_STATIC_ACTIONS": "ACTION_A,ACTION_B"
      }
    }
  }
}
```

## Creating tools

Anyone can create dynamic tools in UnifAI by creating a toolkit.

A toolkit is a collection of tools that are connected to the UnifAI infrastructure, and can be searched and used by agents dynamically.

Initialize a toolkit client with your **toolkit** API key. You can get a toolkit API key for free at [UnifAI](https://app.unifai.network/).

```typescript
import { Toolkit } from 'unifai-sdk';

const toolkit = new Toolkit({ apiKey: 'xxx' });
```

Update the toolkit name and/or description if you need:

```typescript
await toolkit.updateToolkit({ 
  name: "EchoChamber", 
  description: "What's in, what's out." 
});
```

Register action handlers:

```typescript
toolkit.action(
  {
    action: "echo",
    actionDescription: "Echo the message",
    payloadDescription: {
      content: { type: "string" }
    }
  },
  async (ctx, payload) => {
    return ctx.result(`You are agent <${ctx.agentId}>, you said "${payload?.content}".`);
  }
);
```

Note that `payloadDescription` can be any string or a dict that contains enough information for agents to understand the payload format. It doesn't have to be in a certain format, as long as agents can understand it as natural language and generate the correct payload. Think of it as the comments and docs for your API, agents read it and decide what parameters to use. In practice we recommend using JSON schema to match the format of training data.

Start the toolkit:

```typescript
await toolkit.run();
```

## Examples

You can find examples in the `examples` directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.
