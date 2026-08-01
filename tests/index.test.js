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
    globalThis.document = {
        querySelector() {
            return null;
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
    assert.equal(stored.requests.length, 2);
    assert.equal(stored.requests[0].pricing.cost, 0.000001);
    assert.equal(stored.requests[1].source, 'openrouter');
    assert.equal(stored.requests[1].pricing.cost, 0.000002);
    assert.deepEqual(message.swipe_info[0].extra.extensions.chatCompletionBilling, stored);
    assert.equal(saveCount, 1);
});
