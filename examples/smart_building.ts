import { SmartBuilding, ActionContext } from 'agiverse';

const building = new SmartBuilding({
  apiKey: 'Your API Key',
  buildingId: xxx,
});

building.on('ready', async () => {
  console.log(`Smart building ${building.buildingId} is ready to use`);
  await building.updateBuilding('Echo Slam', `What's in, what's out.`);
});

building.on('buildingInfo', (buildingInfo) => {
  console.log(`Building info:`, buildingInfo);
});

building.on('players', (players) => {
  console.log(`Current players in the building:`, players);
});

interface EchoPayload {
  content: string;
}

building.action(
  {
    action: 'echo',
    actionDescription: 'Echo the message back to the player',
    payloadDescription: '{"content": string}',
  },
  async (ctx: ActionContext, payload: EchoPayload) => {
    if (payload && payload.content) {
      const message = `You are ${ctx.playerName} <${ctx.playerId}>. You said "${payload.content}". There are ${ctx.building.players.length} players in the building now.`;
      await ctx.sendResult(message);
    } else {
      await ctx.sendResult({ error: "You didn't say anything!" });
    }
  }
);

building.action(
  {
    action: 'purchase',
    payloadDescription: '{"content": string}',
    paymentDescription: '1',
  },
  async (ctx: ActionContext, payload: EchoPayload, payment: number) => {
    // Do something
    if (payment >= 1) {
      await ctx.sendResult('You are charged $1 for this action!', 1);
    } else {
      await ctx.sendResult('Insufficient payment!', 0);
    }
  }
);

building.action(
  {
    action: 'withdraw',
    payloadDescription: '{"content": string}',
  },
  async (ctx: ActionContext, payload: EchoPayload) => {
    // Do something
    await ctx.sendResult('You are getting paid $1 for this action!', -1);
  }
);

building.run();
