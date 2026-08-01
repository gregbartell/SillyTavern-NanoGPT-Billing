import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createBillingEntryFromMetadata,
    formatBillingDisplay,
    mergeBillingMetadata,
} from '../billing.js';

function makeNanoGptPayload({
    cost = 0.000001,
    pricing = {},
    usage = {},
    cache = undefined,
    currency = 'USD',
    type = 'normal',
    originalType = undefined,
    model = 'moonshotai/kimi-k2.6',
} = {}) {
    return {
        chatCompletionSource: 'nanogpt',
        type,
        originalType,
        model,
        usage: {
            prompt_tokens: 1234,
            completion_tokens: 567,
            team_id: 'team-secret',
            ...usage,
        },
        providerMetadata: {
            x_nanogpt_pricing: {
                provider: 'Auto',
                model,
                cost,
                currency,
                account_id: 'acct-secret',
                payment_id: 'pay-secret',
                ...pricing,
            },
            ...(cache === undefined ? {} : { x_nanogpt_cache: cache }),
        },
    };
}

function makeOpenRouterPayload({
    cost = 0.00042,
    usage = {},
    routingMetadata = {
        endpoints: {
            available: [
                { provider: 'OpenAI', model: 'openai/gpt-4o-mini', selected: true },
            ],
        },
    },
    type = 'normal',
    originalType = undefined,
    model = 'openai/gpt-4o-mini',
} = {}) {
    return {
        chatCompletionSource: 'openrouter',
        type,
        originalType,
        model,
        usage: {
            prompt_tokens: 1234,
            completion_tokens: 567,
            cost,
            ...usage,
        },
        providerMetadata: routingMetadata === undefined
            ? {}
            : { openrouter_metadata: routingMetadata },
    };
}

test('captures NanoGPT amount pricing shape', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: undefined,
        pricing: { amount: 0.001840131 },
    }));

    assert.equal(entry.pricing.amount, 0.001840131);
    assert.equal(formatBillingDisplay({ requests: [entry] }).totalCost, '$0.001840');
});

test('captures NanoGPT cost pricing shape', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload({ cost: 0.000002 }));

    assert.equal(entry.pricing.cost, 0.000002);
    assert.equal(formatBillingDisplay({ requests: [entry] }).totalCost, '$0.000002');
});

test('captures OpenRouter usage cost and selected endpoint', () => {
    const entry = createBillingEntryFromMetadata(makeOpenRouterPayload({
        usage: {
            cost_details: { upstream_inference_cost: 0.0004 },
        },
    }));

    assert.equal(entry.source, 'openrouter');
    assert.equal(entry.provider, 'OpenAI');
    assert.equal(entry.model, 'openai/gpt-4o-mini');
    assert.equal(entry.pricing.cost, 0.00042);
    assert.equal(entry.pricing.currency, 'USD');
    assert.deepEqual(entry.pricing.cost_details, { upstream_inference_cost: 0.0004 });
    assert.equal(formatBillingDisplay({ requests: [entry] }).totalCost, '$0.000420');
});

test('captures OpenRouter cost without routing metadata', () => {
    const entry = createBillingEntryFromMetadata(makeOpenRouterPayload({
        routingMetadata: null,
        model: 'openrouter/auto',
    }));

    assert.equal(entry.provider, 'OpenRouter');
    assert.equal(entry.model, 'openrouter/auto');
    assert.equal(formatBillingDisplay({ requests: [entry] }).totalCost, '$0.000420');
});

test('uses the successful OpenRouter attempt when endpoint metadata is absent', () => {
    const entry = createBillingEntryFromMetadata(makeOpenRouterPayload({
        routingMetadata: {
            attempts: [
                { provider: 'Provider A', model: 'example/model', status: 429 },
                { provider: 'Provider B', model: 'example/model', status: 200 },
            ],
        },
    }));

    assert.equal(entry.provider, 'Provider B');
    assert.equal(entry.model, 'example/model');
});

test('captures OpenRouter cache read and write tokens', () => {
    const entry = createBillingEntryFromMetadata(makeOpenRouterPayload({
        cost: 0.0003,
        usage: {
            prompt_tokens_details: {
                cached_tokens: 1000,
                cache_write_tokens: 500,
            },
        },
    }));

    assert.deepEqual(formatBillingDisplay({ requests: [entry] }), {
        totalCost: '$0.000300',
        cacheCost: null,
        title: 'in/out: 1234t/567t cache: 1000t/500t',
    });
});

test('rejects OpenRouter metadata without a reported cost', () => {
    assert.equal(createBillingEntryFromMetadata(makeOpenRouterPayload({ cost: null })), null);
});

test('accepts a zero-cost OpenRouter response', () => {
    const entry = createBillingEntryFromMetadata(makeOpenRouterPayload({ cost: 0 }));

    assert.equal(formatBillingDisplay({ requests: [entry] }).totalCost, '$0.000000');
});

test('ignores unsupported Chat Completion providers', () => {
    const payload = makeOpenRouterPayload();
    payload.chatCompletionSource = 'openai';

    assert.equal(createBillingEntryFromMetadata(payload), null);
});

test('strips sensitive identifiers', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload());

    assert.equal(entry.pricing.account_id, undefined);
    assert.equal(entry.pricing.payment_id, undefined);
    assert.equal(entry.usage.team_id, undefined);
});

test('formats total cost', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload({ cost: 0.000003 }));
    const display = formatBillingDisplay({ requests: [entry] });

    assert.deepEqual(display, {
        totalCost: '$0.000003',
        cacheCost: null,
        title: 'in/out: 1234t/567t',
    });
});

test('formats cache cost and cache token tooltip', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: 0.000003,
        pricing: { cache_cost: 0.000002 },
        usage: { cache_read_tokens: 1000, cache_write_tokens: 500 },
    }));
    const display = formatBillingDisplay({ requests: [entry] });

    assert.deepEqual(display, {
        totalCost: '$0.000003',
        cacheCost: '$0.000002',
        title: 'in/out: 1234t/567t cache: 1000t/500t',
    });
});

test('ignores missing usage', () => {
    const payload = makeNanoGptPayload();
    payload.usage = null;

    assert.equal(createBillingEntryFromMetadata(payload), null);
});

test('ignores missing pricing', () => {
    const payload = makeNanoGptPayload();
    delete payload.providerMetadata.x_nanogpt_pricing;

    assert.equal(createBillingEntryFromMetadata(payload), null);
});

test('ignores non-USD pricing', () => {
    assert.equal(createBillingEntryFromMetadata(makeNanoGptPayload({ currency: 'EUR' })), null);
});

test('appends continue and append requests', () => {
    const first = createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: 0.000001,
        usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
    const second = createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: 0.000002,
        usage: { prompt_tokens: 50, completion_tokens: 30 },
        originalType: 'continue',
    }));

    let metadata = mergeBillingMetadata(undefined, first);
    metadata = mergeBillingMetadata(metadata, second, { append: true });

    const display = formatBillingDisplay(metadata);
    assert.equal(metadata.requests.length, 2);
    assert.equal(display.totalCost, '$0.000003');
    assert.equal(display.title, 'in/out: 150t/50t');
});

test('formats legacy NanoGPT requests without a source field', () => {
    const entry = createBillingEntryFromMetadata(makeNanoGptPayload({ cost: 0.000002 }));
    delete entry.source;

    assert.equal(formatBillingDisplay({ version: 1, requests: [entry] }).totalCost, '$0.000002');
});

test('uses selected swipe metadata independently', () => {
    const first = mergeBillingMetadata(undefined, createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: 0.000001,
        model: 'first/model',
    })));
    const second = mergeBillingMetadata(undefined, createBillingEntryFromMetadata(makeNanoGptPayload({
        cost: 0.000002,
        model: 'second/model',
    })));
    const message = {
        swipe_id: 1,
        swipe_info: [
            { extra: { extensions: { nanogptBilling: first } } },
            { extra: { extensions: { nanogptBilling: second } } },
        ],
    };

    const selected = message.swipe_info[message.swipe_id].extra.extensions.nanogptBilling;
    assert.equal(formatBillingDisplay(selected).totalCost, '$0.000002');
});
