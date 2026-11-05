import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/storage/database";
import { MessageRepository } from "../src/storage/messageRepository";
import { ChatRepository } from "../src/storage/chatRepository";

function createMemoryRepo() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  return { db, messages: new MessageRepository(db), chats: new ChatRepository(db) };
}

test("duplicate matches for the same chat+message are stored only once", () => {
  const { messages } = createMemoryRepo();
  const input = {
    chatId: -1001234567890,
    messageId: 42,
    messageDate: 1234567890,
    text: "big airdrop announcement",
    matchedKeywords: ["airdrop"],
    link: null,
  };

  const first = messages.addMatch(input);
  const second = messages.addMatch(input);

  assert.ok(first > 0, "first insert should succeed");
  assert.equal(second, 0, "duplicate insert should be ignored");
});

test("processed-message tracking prevents reprocessing after a restart", () => {
  const { messages } = createMemoryRepo();
  const chatId = -1001234567890;

  assert.equal(messages.isProcessed(chatId, 1), false);
  messages.markProcessed(chatId, 1, true);
  assert.equal(messages.isProcessed(chatId, 1), true);
  assert.equal(messages.isProcessed(chatId, 2), false);
});

test("chat monitoring can be toggled (include/exclude)", () => {
  const { chats } = createMemoryRepo();
  const chat = chats.upsert({
    id: -1001234567890,
    title: "Crypto Signals",
    username: "cryptosignals",
    type: "channel",
  });

  assert.equal(chat.is_monitored, 1);
  chats.setMonitored(chat.id, false);
  assert.equal(chats.getById(chat.id)!.is_monitored, 0);
  assert.equal(chats.getMonitored().length, 0);
  assert.equal(chats.getExcluded().length, 1);
});
