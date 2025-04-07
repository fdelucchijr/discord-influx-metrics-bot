import { InfluxDB, Point } from "@influxdata/influxdb-client";
import { Client, Events, GatewayIntentBits } from "discord.js";

// Discord Setup
const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

discordClient.on(Events.ClientReady, (readyClient) => {
  console.log(`[global]: Logged in as ${readyClient.user.tag}`);
});

// Influx Setup
const influxClient = new InfluxDB({
  url: process.env.INFLUXDB_HOST!,
  token: process.env.INFLUXDB_TOKEN,
});
let writeClient = influxClient.getWriteApi(
  process.env.INFLUXDB_ORG!,
  process.env.INFLUXDB_BUCKET!,
  "ns"
);

// Signal generator
// Sends a packet every x seconds. Makes the read of the data less expensive
const pendingActions: Map<string, () => void> = new Map();
setInterval(async function () {
  pendingActions.forEach((e) => e());
  await writeClient.flush();
}, 10 * 1000); // 60 * 1000 milsec

// Abstraction to DB
type ResourceRecordT = {
  id: string;
  name: string;
};
const generationOfPoints =
  (channel: ResourceRecordT, guild: ResourceRecordT) =>
  (users: ResourceRecordT[]) =>
    users
      .map((user) =>
        new Point("voice_state")
          .tag("server_id", guild.id)
          .tag("channel_id", channel.id)
          .stringField("user_id", user.id)
          .stringField("channel_name", channel.name)
          .stringField("user_nickname", user.name)
      )
      .map((e) => {
        writeClient.writePoint(e);
        return e;
      });

// Domain
discordClient.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const channel = newState.channel || oldState.channel;
    if (!channel) return;
    const channelCache = discordClient.channels.cache.get(channel.id);
    if (!channelCache) return;
    pendingActions.set(channelCache.id, () => {
      const generator = generationOfPoints(channel, newState.guild);
      if (!channelCache?.isVoiceBased()) return;
      const members = channelCache.members!.map((member) => ({
        id: member.id,
        name: member.nickname ?? member.user.username,
      }));
      if (members.length < 1) pendingActions.delete(channelCache.id);
      console.log(
        `[${new Date().toISOString()}][${newState.guild.name}][${
          channel.name
        }]: Signaling for ${members.length} members`
      );
      return generator(members);
    });
  } catch (error) {
    console.error(error);
  }
});

discordClient.login(process.env.DISCORD_BOT_TOKEN);

console.log("[global]: Inited listening");
