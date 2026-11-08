import test from 'node:test';
import assert from 'node:assert/strict';
import { init } from '../index.js';

test('reads legacy settings and appends OpenRouter billing into the provider-neutral key', async (t) => {
    const previousSillyTavern = globalThis.SillyTavern;
    const previousDocument = globalThis.document;
    const handlers = new Map();
    let saveCount = 0;
    const legacyMetadata = {
        version: 1,
        requests: [{
            provider: 'Auto',
            model: 'nano/model',
            pricing: { cost: 0.000001, currency: 'USD' },
            usage: { prompt_tokens: 100, completion_tokens: 20 },
            created_at: 1,
            type: 'normal',
        }],
        incomplete: false,
    };
    const message = {
        extra: { extensions: { nanogptBilling: legacyMetadata } },
        swipe_id: 0,
        swipe_info: [{
            extra: { extensions: { nanogptBilling: legacyMetadata } },
        }],
    };
    const eventTypes = {
        CHAT_COMPLETION_RESPONSE_METADATA: 'chat_completion_response_metadata',
        CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        MESSAGE_SWIPED: 'message_swiped',
        CHAT_CHANGED: 'chat_changed',
        MORE_MESSAGES_LOADED: 'more_messages_loaded',
        GENERATION_STARTED: 'generation_started',
        GENERATION_ENDED: 'generation_ended',
    };
    const context = {
        chat: [message],
        eventTypes,
        eventSource: {
            on(eventName, handler) {
                handlers.set(eventName, handler);
            },
        },
        extensionSettings: {
            nanogptBilling: { enabled: true },
        },
        saveSettingsDebounced() {},
        async saveChat() {
            saveCount++;
        },
    };

    globalThis.SillyTavern = { getContext: () => context };
    const totalLine = { textContent: '', title: '' };
    const display = { querySelector: () => totalLine };
    const wrapper = { querySelector: () => display };
    const messageElement = { querySelector: () => wrapper, querySelectorAll: () => [] };
    globalThis.document = {
        querySelector(selector) {
            return selector.startsWith('#chat .mes') ? messageElement : null;
        },
        querySelectorAll() {
            return [];
        },
    };

    t.after(() => {
        globalThis.SillyTavern = previousSillyTavern;
        globalThis.document = previousDocument;
    });

    await init();

    assert.deepEqual(context.extensionSettings.chatCompletionBilling, { enabled: true });

    const metadataHandler = handlers.get(eventTypes.CHAT_COMPLETION_RESPONSE_METADATA);
    assert.equal(typeof metadataHandler, 'function');

    await metadataHandler({
        messageId: 0,
        swipeId: 0,
        type: 'continue',
        originalType: 'continue',
        chatCompletionSource: 'openrouter',
        model: 'openai/gpt-4o-mini',
        usage: {
            prompt_tokens: 50,
            completion_tokens: 30,
            cost: 0.000002,
        },
        providerMetadata: {},
    });

    const stored = message.extra.extensions.chatCompletionBilling;
    assert.equal(stored.incomplete, false);
    assert.equal(stored.requests.length, 2);
    assert.equal(stored.requests[0].pricing.cost, 0.000001);
    assert.equal(stored.requests[1].source, 'openrouter');
    assert.equal(stored.requests[1].pricing.cost, 0.000002);
    assert.deepEqual(message.swipe_info[0].extra.extensions.chatCompletionBilling, stored);
    assert.equal(saveCount, 1);
    assert.equal(totalLine.textContent, 'cost: $0.000003');

    // Missing usage after a continuation must invalidate both the live message
    // and its persisted swipe, without touching other swipes.
    message.swipe_info.push({ extra: { extensions: { chatCompletionBilling: structuredClone(stored) } } });
    await metadataHandler({
        messageId: 0, swipeId: 0, type: 'continue', originalType: 'continue',
        chatCompletionSource: 'openrouter', model: 'openai/gpt-4o-mini', usage: null,
    });
    assert.equal(message.extra.extensions.chatCompletionBilling.incomplete, true);
    assert.equal(message.swipe_info[0].extra.extensions.chatCompletionBilling.incomplete, true);
    assert.equal(message.swipe_info[1].extra.extensions.chatCompletionBilling.incomplete, false);
    assert.equal(saveCount, 2);
    assert.equal(totalLine.textContent, 'cost: unavailable');

    // A reloaded chat and swipe selection render the stored value, not a
    // price recomputed from current provider settings.
    context.chat = JSON.parse(JSON.stringify(context.chat));
    context.chat[0].swipe_id = 1;
    handlers.get(eventTypes.MESSAGE_SWIPED)(0);
    assert.equal(totalLine.textContent, 'cost: $0.000003');
    context.chat[0].swipe_id = 0;
    handlers.get(eventTypes.CHARACTER_MESSAGE_RENDERED)(0);
    assert.equal(totalLine.textContent, 'cost: unavailable');

    // Saved responses from other APIs explicitly signal that no cost is known.
    // Background generations have no saved message event and cannot affect this.
    context.chat[0].swipe_id = 1;
    context.chat[0].extra = structuredClone(context.chat[0].swipe_info[1].extra);
    await metadataHandler({ messageId: 0, swipeId: 1, type: 'appendFinal', originalType: 'continue', usage: null, chatCompletionSource: null });
    assert.equal(context.chat[0].extra.extensions.chatCompletionBilling.incomplete, true);
    assert.equal(context.chat[0].swipe_info[1].extra.extensions.chatCompletionBilling.incomplete, true);
    assert.equal(totalLine.textContent, 'cost: unavailable');

    // Targeting an archived swipe must not overwrite the selected swipe.
    context.chat[0].extra.extensions.chatCompletionBilling = structuredClone(stored);
    context.chat[0].swipe_info[1].extra.extensions.chatCompletionBilling = structuredClone(stored);
    await metadataHandler({ messageId: 0, swipeId: 0, type: 'continue', usage: null, chatCompletionSource: null });
    assert.equal(context.chat[0].swipe_info[0].extra.extensions.chatCompletionBilling.incomplete, true);
    assert.equal(context.chat[0].extra.extensions.chatCompletionBilling.incomplete, false);
});
