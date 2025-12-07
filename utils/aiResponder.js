import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import getUserName from "../helper/getUserName.js";
import { titleCase } from "../helper/titleCase.js";
import splitMessage from "../helper/splitMessage.js";

const conversationMemory = new Map();

async function aiResponder(message, args, systemInstruction, commandName) {
  const genAI = new GoogleGenerativeAI(process.env.API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `${systemInstruction}. the timezone is Asia/Jakarta or UTC +7 and don't include any conversation context and user's prompt in the response`,
    tools: [{ googleSearch: {} }],
  });

  const user = getUserName(message);
  const guildId = message.guildId;

  // Use a combination of guildId and commandName for namespacing
  const memoryKey = `${guildId}-${commandName}`;

  if (!conversationMemory.has(memoryKey)) {
    conversationMemory.set(memoryKey, []);
  }
  const channelHistory = conversationMemory.get(memoryKey);

  try {
    const isNotEmpty = args.length > 0;
    const prompt = isNotEmpty
      ? args.join(" ")
      : `Halo, ${titleCase(commandName)}!`;

    if (!isNotEmpty) {
      conversationMemory.set(memoryKey, []);
    }

    if (prompt.toLowerCase() === "reset") {
      conversationMemory.set(memoryKey, []);
      await message.channel.send("Chat history has been reset.");
      return;
    }

    const contextString = channelHistory
      .slice(-5)
      .map((msg) => `${msg.sender}: ${msg.content}`)
      .join("\n");

    const result = await model.generateContent(
      `Conversation Context:\n${contextString}\n\n
      from ${user}: ${prompt}
      `,
    );

    const aiResponse = result.response.text();

    const responseParts = splitMessage(aiResponse);

    for (const part of responseParts) {
      await message.channel.send(part);
    }

    channelHistory.push(
      { sender: user, content: prompt },
      { sender: commandName, content: aiResponse },
    );
  } catch (error) {
    console.error("Gemini API error:", error);
    await message.channel.send(
      "Sorry, something went wrong with the AI generation.",
    );
  }
}

export default aiResponder;
