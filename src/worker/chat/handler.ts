// POST /api/chat — streams the assistant's reply as Server-Sent Events.
//
// The client sends plain-text history only; tool calls and results live for
// one request and are re-run when needed. That keeps requests small and means
// a client can never inject fake tool results.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ChatCard, ChatEvent } from '../../shared/types.ts';
import type { AppEnv } from '../env.ts';
import { costMicrodollars, recordSpend, spendCapMicrodollars, spentToday } from '../guard.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { TOOL_STATUS, TOOLS, executeTool, isToolName } from './tools.ts';

const MODEL = 'claude-haiku-4-5';
const MAX_ITERATIONS = 6;
const MAX_TOKENS = 2048;
const HOLD_CHARS = 240;

// Generous limits that only reject abuse; toApiMessages() trims to what is actually sent.
export const ChatBody = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20000) }))
    .min(1)
    .max(200),
  context_slug: z
    .string()
    .regex(/^[a-z0-9-]{1,120}$/)
    .optional(),
});
export type ChatBody = z.infer<typeof ChatBody>;

/** Last 12 turns, user turns capped at 1,000 chars, starting on a user turn. */
export function toApiMessages(body: ChatBody): Anthropic.MessageParam[] {
  const turns = body.messages.filter((t) => t.content.trim() !== '').slice(-12);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  const msgs: Anthropic.MessageParam[] = turns.map((t) => ({
    role: t.role,
    content: t.role === 'user' ? t.content.slice(0, 1000) : t.content.slice(0, 4000),
  }));
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'user' && body.context_slug) {
    last.content = `[The user is viewing the section page with slug "${body.context_slug}".]\n\n${last.content as string}`;
  }
  return msgs;
}

export function chatStream(env: AppEnv, ctx: ExecutionContext, body: ChatBody): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (e: ChatEvent) => writer.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => undefined);

  ctx.waitUntil(
    runLoop(env, ctx, body, send)
      .catch((err) => {
        console.error('chat failed', err);
        let message = 'Something went wrong. Please try again.';
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
          message = 'The assistant is busy right now. Please try again in a minute.';
        }
        return send({ type: 'error', message });
      })
      .finally(async () => {
        await send({ type: 'done' });
        await writer.close().catch(() => undefined);
      }),
  );

  return new Response(readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}

async function runLoop(env: AppEnv, ctx: ExecutionContext, body: ChatBody, send: (e: ChatEvent) => Promise<unknown>) {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.AI_GATEWAY_URL || undefined,
    maxRetries: 1,
  });
  const messages = toApiMessages(body);
  const cap = spendCapMicrodollars(env);
  const emitCard = (card: ChatCard) => void send({ type: 'card', card });
  let wroteText = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if ((await spentToday(env.DB)) >= cap) {
      await send({ type: 'error', message: "River Guide's chat has reached today's limit. The river pages still work, and chat will be back tomorrow." });
      return;
    }

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
    // Short preambles before a tool call ("Let me check…") are dropped: text is
    // held back until it is clearly an answer (> HOLD_CHARS) or the round ends
    // without a tool call. Text from an earlier round gets a paragraph break.
    let roundStarted = false;
    let held = '';
    let live = false;
    const emit = (text: string) => {
      if (!text) return;
      if (wroteText && !roundStarted) void send({ type: 'text', text: '\n\n' });
      roundStarted = true;
      wroteText = true;
      void send({ type: 'text', text });
    };

    let message: Anthropic.Message;
    try {
      for await (const ev of stream) {
        if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use' && !live) held = '';
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (live) emit(ev.delta.text);
          else if ((held += ev.delta.text).length > HOLD_CHARS) {
            live = true;
            emit(held);
            held = '';
          }
        }
      }
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;
      // A tool input that could not be parsed: retry the turn once.
      if (i < MAX_ITERATIONS - 1) continue;
      throw err;
    }
    ctx.waitUntil(recordSpend(env.DB, costMicrodollars(message.usage)));

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) emit(held);
    if (message.stop_reason === 'refusal' || toolUses.length === 0) return;
    if (message.stop_reason === 'max_tokens') {
      await send({ type: 'error', message: 'That answer ran too long. Try a narrower question.' });
      return;
    }

    messages.push({ role: 'assistant', content: message.content });
    for (const name of new Set(toolUses.map((t) => t.name))) {
      if (isToolName(name)) await send({ type: 'status', label: TOOL_STATUS[name] });
    }
    const results = await Promise.all(
      toolUses.map(async (t): Promise<Anthropic.ToolResultBlockParam> => {
        const r = await executeTool(t.name, t.input, { env, ctx, emitCard });
        return { type: 'tool_result', tool_use_id: t.id, content: r.content, is_error: r.is_error };
      }),
    );
    messages.push({ role: 'user', content: results });
  }
  await send({ type: 'text', text: '\n\n(Stopped after several lookups — try asking a more specific question.)' });
}
