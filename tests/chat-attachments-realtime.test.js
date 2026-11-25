import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const chat = read("../public/js/chat.js");
const worker = read("../src/index.js");
const html = read("../public/index.html");
const migration = read("../database/chat_attachments_realtime.sql");

test("chat subscribes to participant-scoped Postgres changes", () => {
  assert.match(chat, /@supabase\/supabase-js@2\.99\.1/);
  assert.match(chat, /client\.realtime\.setAuth\(session\.access_token\)/);
  assert.match(chat, /table: "chat_messages", filter: "conversation_id=eq\."/);
  assert.match(chat, /realtimeStatus !== "SUBSCRIBED"/);
  assert.match(chat, /window\.EAMChat = \{ start, stop: stopRealtime \}/);
});

test("chat supports image and PDF attachments through authenticated Worker routes", () => {
  assert.match(html, /id="chat-attachment-input"/);
  assert.match(html, /application\/pdf/);
  assert.match(chat, /FormData\(\)/);
  assert.match(chat, /\/api\/chat\/attachments/);
  assert.match(chat, /\/api\/chat\/attachment\?path=/);
  assert.match(worker, /path === "\/api\/chat\/attachments"/);
  assert.match(worker, /path === "\/api\/chat\/attachment"/);
  assert.match(worker, /15 \* 1024 \* 1024/);
  assert.match(worker, /x-upsert/);
  assert.match(worker, /attachment_mime_type: file\.type/);
});

test("database migration permits only supported private chat attachment metadata", () => {
  assert.match(migration, /message_type in \('image','file'\)/);
  assert.match(migration, /attachment_size_bytes between 1 and 15728640/);
  assert.match(migration, /alter publication supabase_realtime add table public\.chat_messages/);
});
