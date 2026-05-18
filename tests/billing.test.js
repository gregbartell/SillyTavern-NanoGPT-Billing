import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createNanoGptBillingEntryFromMetadata,
    formatNanoGptBillingDisplay,
    mergeNanoGptBillingMetadata,
} from '../billing.js';

function makePayload({
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

test('captures NanoGPT amount pricing shape', () => {
    const entry = createNanoGptBillingEntryFromMetadata(makePayload({
        cost: undefined,
        pricing: { amount: 0.001840131 },
    }));

    assert.equal(entry.pricing.amount, 0.001840131);
    assert.equal(formatNanoGptBillingDisplay({ requests: [entry] }).totalCost, '$0.001840');
});

test('captures NanoGPT cost pricing shape', () => {
    const entry = createNanoGptBillingEntryFromMetadata(makePayload({ cost: 0.000002 }));

    assert.equal(entry.pricing.cost, 0.000002);
    assert.equal(formatNanoGptBillingDisplay({ requests: [entry] }).totalCost, '$0.000002');
});

test('strips sensitive identifiers', () => {
    const entry = createNanoGptBillingEntryFromMetadata(makePayload());

    assert.equal(entry.pricing.account_id, undefined);
    assert.equal(entry.pricing.payment_id, undefined);
    assert.equal(entry.usage.team_id, undefined);
});

test('formats total cost', () => {
    const entry = createNanoGptBillingEntryFromMetadata(makePayload({ cost: 0.000003 }));
    const display = formatNanoGptBillingDisplay({ requests: [entry] });

    assert.deepEqual(display, {
        totalCost: '$0.000003',
        cacheCost: null,
        title: 'in/out: 1234t/567t',
    });
});

test('formats cache cost and cache token tooltip', () => {
    const entry = createNanoGptBillingEntryFromMetadata(makePayload({
        cost: 0.000003,
        pricing: { cache_cost: 0.000002 },
        usage: { cache_read_tokens: 1000, cache_write_tokens: 500 },
    }));
    const display = formatNanoGptBillingDisplay({ requests: [entry] });

    assert.deepEqual(display, {
        totalCost: '$0.000003',
        cacheCost: '$0.000002',
        title: 'in/out: 1234t/567t cache: 1000t/500t',
    });
});

test('ignores missing usage', () => {
    const payload = makePayload();
    payload.usage = null;

    assert.equal(createNanoGptBillingEntryFromMetadata(payload), null);
});

test('ignores missing pricing', () => {
    const payload = makePayload();
    delete payload.providerMetadata.x_nanogpt_pricing;

    assert.equal(createNanoGptBillingEntryFromMetadata(payload), null);
});

test('ignores non-USD pricing', () => {
    assert.equal(createNanoGptBillingEntryFromMetadata(makePayload({ currency: 'EUR' })), null);
});

test('appends continue and append requests', () => {
    const first = createNanoGptBillingEntryFromMetadata(makePayload({
        cost: 0.000001,
        usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
    const second = createNanoGptBillingEntryFromMetadata(makePayload({
        cost: 0.000002,
        usage: { prompt_tokens: 50, completion_tokens: 30 },
        originalType: 'continue',
    }));

    let metadata = mergeNanoGptBillingMetadata(undefined, first);
    metadata = mergeNanoGptBillingMetadata(metadata, second, { append: true });

    const display = formatNanoGptBillingDisplay(metadata);
    assert.equal(metadata.requests.length, 2);
    assert.equal(display.totalCost, '$0.000003');
    assert.equal(display.title, 'in/out: 150t/50t');
});

test('uses selected swipe metadata independently', () => {
    const first = mergeNanoGptBillingMetadata(undefined, createNanoGptBillingEntryFromMetadata(makePayload({
        cost: 0.000001,
        model: 'first/model',
    })));
    const second = mergeNanoGptBillingMetadata(undefined, createNanoGptBillingEntryFromMetadata(makePayload({
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
    assert.equal(formatNanoGptBillingDisplay(selected).totalCost, '$0.000002');
});
