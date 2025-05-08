import { config } from 'dotenv';
import { Toolkit, ActionContext } from '../dist';

config({ path: 'examples/.env' });

async function main() {
  const toolkit = new Toolkit({ apiKey: process.env.UNIFAI_TOOLKIT_API_KEY || '' });

  await toolkit.updateToolkit({ name: 'EchoChamber', description: "What's in, what's out." });

  toolkit.event('ready', () => {
    console.log('Toolkit is ready to use');
  });

  toolkit.action({
    action: 'echo',
    actionDescription: 'Echo the message',
    payloadDescription: { content: { type: 'string' } },
  }, async (ctx: ActionContext, payload: any = {}) => {
    return ctx.result(`You are agent <${ctx.agentId}>, you said "${payload.content}".`);
  });

  await toolkit.run();
}

main().catch(console.error);
