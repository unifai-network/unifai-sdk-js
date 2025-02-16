# unifai-sdk-js

unifai-sdk-js is the JavaScript/TypeScript SDK for Unifai, an AI native platform for dynamic tools and agent to agent communication.

## Installation

```bash
npm install unifai-sdk
```

## Getting your Unifai API key

You can get your API key for free from [Unifai](https://app.unifai.network/).

There are two types of API keys:

- Agent API key: for using toolkits in your own agents.
- Toolkit API key: for creating toolkits that can be used by other agents.

## Using tools

To use tools in your agents, you need an **agent** API key. You can get an agent API key for free at [Unifai](https://app.unifai.network/).

```typescript
import { Tools } from 'unifai-sdk';

const tools = new Tools({ apiKey: 'xxx' });
```

Then you can pass the tools to any OpenAI compatible API. Popular options include:

- OpenAI's native API: For using OpenAI models directly
- [OpenRouter](https://openrouter.ai/docs): A service that gives you access to most LLMs through a single OpenAI compatible API

The tools will work with any API that follows the OpenAI function calling format. This gives you the flexibility to choose the best LLM for your needs while keeping your tools working consistently.

```typescript
const messages = [{ content: "Can you tell me what is trending on Google today?", role: "user" }];
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages,
  tools: tools.getTools(),
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
    tools: tools.getTools(),
  });
  messages.push(response.choices[0].message);
  const results = await tools.callTools(response.choices[0].message.tool_calls);
  if (results.length === 0) break;
  messages.push(...results);
}
```

### Using tools in MCP clients

We provide a MCP server to access tools in any [MCP clients](https://modelcontextprotocol.io/clients) such as [Claude Desktop](https://modelcontextprotocol.io/quickstart/user).

The easiest way to run the server is using `uv`, see [Instaling uv](https://docs.astral.sh/uv/getting-started/installation/) if you haven't installed it yet.

Then in your Claude Desktop config:

```json
{
  "mcpServers": {
    "unifai-tools": {
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

Now your Claude Desktop will be able to access all the tools in Unifai automatically.

## Creating tools

Anyone can create dynamic tools in Unifai by creating a toolkit.

A toolkit is a collection of tools that are connected to the Unifai infrastructure, and can be searched and used by agents dynamically.

Initialize a toolkit client with your **toolkit** API key. You can get a toolkit API key for free at [Unifai](https://app.unifai.network/).

```typescript
import { Toolkit } from 'unifai-sdk';

const toolkit = new Toolkit({ apiKey: 'xxx' });
```

Update the toolkit name and/or description if you need:

```typescript
await toolkit.updateToolkit({ 
  name: "Echo Slam", 
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

Note that `payloadDescription` can be any string or a dict that contains enough information for agents to understand the payload format. It doesn't have to be in certain format, as long as agents can understand it as natural language and generate correct payload. Think of it as the comments and docs for your API, agents read it and decide what parameters to use.

Start the toolkit:

```typescript
await toolkit.run();
```

## Examples

You can find examples in the `examples` directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.
