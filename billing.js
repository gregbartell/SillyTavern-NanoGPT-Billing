const MAX_STRING_LENGTH = 256;
const MAX_ARRAY_LENGTH = 32;
const MAX_OBJECT_DEPTH = 4;
const SENSITIVE_KEY_PATTERN = /(?:account|team|payment|invoice|customer|email|api[_-]?key|secret|credential|wallet|balance|credit|subscription|organization|org_id)/i;
const SOURCE_NANOGPT = 'nanogpt';
const SOURCE_OPENROUTER = 'openrouter';

const TOTAL_COST_PATHS = [
    'amount',
    'cost',
    'total_cost',
    'totalCost',
    'cost_usd',
    'total_cost_usd',
];

const CACHE_COST_PATHS = [
    'cache_cost',
    'cacheCost',
    'cache_cost_usd',
    'cache_total_cost',
    'cacheTotalCost',
    'total_cache_cost',
    'totalCacheCost',
];

const INPUT_TOKEN_PATHS = [
    'prompt_tokens',
    'input_tokens',
];

const OUTPUT_TOKEN_PATHS = [
    'completion_tokens',
    'output_tokens',
];

const CACHE_READ_TOKEN_PATHS = [
    'readTokens',
    'cache_read_tokens',
    'cache_read_input_tokens',
    'cached_tokens',
    'prompt_tokens_details.cached_tokens',
    'input_tokens_details.cached_tokens',
];

const CACHE_WRITE_TOKEN_PATHS = [
    'writeTokens',
    'cache_write_tokens',
    'cache_write_input_tokens',
    'cache_creation_tokens',
    'cache_creation_input_tokens',
    'prompt_tokens_details.cache_creation_tokens',
    'prompt_tokens_details.cache_write_tokens',
    'input_tokens_details.cache_creation_tokens',
    'input_tokens_details.cache_write_tokens',
];

const PROVIDER_PATHS = [
    'provider',
    'provider_name',
    'providerName',
];

const MODEL_PATHS = [
    'model',
    'model_name',
    'modelName',
];

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPath(source, path) {
    const parts = path.split('.');
    let value = source;

    for (const part of parts) {
        if (!isPlainObject(value) || !Object.hasOwn(value, part)) {
            return undefined;
        }

        value = value[part];
    }

    return value;
}

function pickValue(source, paths) {
    if (!isPlainObject(source)) {
        return undefined;
    }

    for (const path of paths) {
        const value = readPath(source, path);
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return undefined;
}

function toTokenCount(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
        return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return Number.isSafeInteger(parsed) ? parsed : null;
    }

    return null;
}

function toCost(value) {
    if (typeof value !== 'number' && typeof value !== 'string') {
        return null;
    }

    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toDisplayString(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }

    const stringValue = String(value).trim();
    return stringValue ? stringValue.slice(0, MAX_STRING_LENGTH) : null;
}

function isUsdPricing(pricing) {
    const currency = toDisplayString(pricing.currency);
    return !currency || currency.toUpperCase() === 'USD';
}

function sanitizeBillingMetadata(value, depth = 0) {
    if (value === null || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string') {
        return value.slice(0, MAX_STRING_LENGTH);
    }

    if (depth >= MAX_OBJECT_DEPTH) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_LENGTH)
            .map(item => sanitizeBillingMetadata(item, depth + 1))
            .filter(item => item !== undefined);
    }

    if (isPlainObject(value)) {
        const sanitized = {};

        for (const [key, item] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) {
                continue;
            }

            const sanitizedItem = sanitizeBillingMetadata(item, depth + 1);
            if (sanitizedItem !== undefined) {
                sanitized[key] = sanitizedItem;
            }
        }

        return sanitized;
    }

    return undefined;
}

function createBillingRequest({ source, payload, pricing, usage, cache, provider, model }) {
    if (!isPlainObject(payload) || !isPlainObject(usage) || !isPlainObject(pricing)) {
        return null;
    }

    const totalCost = toCost(pickValue(pricing, TOTAL_COST_PATHS));
    const inputTokens = toTokenCount(pickValue(usage, INPUT_TOKEN_PATHS));
    const outputTokens = toTokenCount(pickValue(usage, OUTPUT_TOKEN_PATHS));

    if (totalCost === null || inputTokens === null || outputTokens === null || !isUsdPricing(pricing)) {
        return null;
    }

    const sanitizedPricing = sanitizeBillingMetadata(pricing);
    const sanitizedUsage = sanitizeBillingMetadata(usage);
    const sanitizedCache = isPlainObject(cache) ? sanitizeBillingMetadata(cache) : undefined;

    if (!isPlainObject(sanitizedPricing) || !isPlainObject(sanitizedUsage)) {
        return null;
    }

    const request = {
        source,
        provider: toDisplayString(provider),
        model: toDisplayString(model),
        pricing: sanitizedPricing,
        usage: sanitizedUsage,
        ...(isPlainObject(sanitizedCache) ? { cache: sanitizedCache } : {}),
        created_at: Date.now(),
        type: typeof payload.originalType === 'string' && payload.originalType ? payload.originalType : payload.type,
    };

    return sanitizeBillingRequest(request);
}

function createNanoGptBillingRequest(payload) {
    const usage = payload?.usage;
    const pricing = payload?.providerMetadata?.x_nanogpt_pricing;
    const cache = payload?.providerMetadata?.x_nanogpt_cache;

    return createBillingRequest({
        source: SOURCE_NANOGPT,
        payload,
        pricing,
        usage,
        cache,
        provider: pickValue(pricing, PROVIDER_PATHS) ?? payload?.provider ?? 'Auto',
        model: pickValue(pricing, MODEL_PATHS) ?? payload?.model,
    });
}

function getSelectedOpenRouterEndpoint(routingMetadata) {
    const available = routingMetadata?.endpoints?.available;
    if (Array.isArray(available)) {
        const selected = available.find(endpoint => isPlainObject(endpoint) && endpoint.selected === true);
        if (selected) {
            return selected;
        }
    }

    const attempts = routingMetadata?.attempts;
    if (Array.isArray(attempts)) {
        for (let index = attempts.length - 1; index >= 0; index--) {
            const attempt = attempts[index];
            if (isPlainObject(attempt) && Number(attempt.status) >= 200 && Number(attempt.status) < 300) {
                return attempt;
            }
        }
    }

    return undefined;
}

function createOpenRouterBillingRequest(payload) {
    const usage = payload?.usage;
    const routingMetadata = payload?.providerMetadata?.openrouter_metadata;
    const selectedEndpoint = getSelectedOpenRouterEndpoint(routingMetadata);
    const pricing = {
        cost: usage?.cost,
        currency: 'USD',
        ...(isPlainObject(usage?.cost_details) ? { cost_details: usage.cost_details } : {}),
    };

    return createBillingRequest({
        source: SOURCE_OPENROUTER,
        payload,
        pricing,
        usage,
        provider: selectedEndpoint?.provider ?? 'OpenRouter',
        model: selectedEndpoint?.model ?? payload?.model,
    });
}

const BILLING_ADAPTERS = new Map([
    [SOURCE_NANOGPT, createNanoGptBillingRequest],
    [SOURCE_OPENROUTER, createOpenRouterBillingRequest],
]);

export function createBillingEntryFromMetadata(payload) {
    if (!isPlainObject(payload)) {
        return null;
    }

    const adapter = BILLING_ADAPTERS.get(payload.chatCompletionSource);
    return adapter?.(payload) ?? null;
}

function sanitizeBillingRequest(request) {
    if (!isPlainObject(request) || !isPlainObject(request.pricing) || !isPlainObject(request.usage)) {
        return null;
    }

    const totalCost = toCost(pickValue(request.pricing, TOTAL_COST_PATHS));
    const inputTokens = toTokenCount(pickValue(request.usage, INPUT_TOKEN_PATHS));
    const outputTokens = toTokenCount(pickValue(request.usage, OUTPUT_TOKEN_PATHS));

    if (totalCost === null || inputTokens === null || outputTokens === null || !isUsdPricing(request.pricing)) {
        return null;
    }

    const pricing = sanitizeBillingMetadata(request.pricing);
    const usage = sanitizeBillingMetadata(request.usage);
    const cache = isPlainObject(request.cache) ? sanitizeBillingMetadata(request.cache) : undefined;

    if (!isPlainObject(pricing) || !isPlainObject(usage)) {
        return null;
    }

    const createdAt = toTokenCount(request.created_at) ?? Date.now();

    return {
        source: toDisplayString(request.source),
        provider: toDisplayString(request.provider),
        model: toDisplayString(request.model),
        pricing,
        usage,
        ...(isPlainObject(cache) ? { cache } : {}),
        created_at: createdAt,
        type: typeof request.type === 'string' && request.type ? request.type.slice(0, 64) : 'normal',
    };
}

export function mergeBillingMetadata(existing, request, { append = false } = {}) {
    const sanitizedRequest = sanitizeBillingRequest(request);
    if (!sanitizedRequest) {
        return undefined;
    }

    const existingRequests = append && isPlainObject(existing) && Array.isArray(existing.requests)
        ? existing.requests.map(sanitizeBillingRequest).filter(Boolean)
        : [];
    const incomplete = append && isPlainObject(existing) && existing.incomplete === true;

    return {
        version: 1,
        requests: [...existingRequests, sanitizedRequest],
        incomplete,
    };
}

function formatUsd(value) {
    return `$${Number(value).toFixed(6)}`;
}

function getRequestMetrics(request) {
    const totalCost = toCost(pickValue(request.pricing, TOTAL_COST_PATHS));
    const inputTokens = toTokenCount(pickValue(request.usage, INPUT_TOKEN_PATHS));
    const outputTokens = toTokenCount(pickValue(request.usage, OUTPUT_TOKEN_PATHS));

    if (totalCost === null || inputTokens === null || outputTokens === null) {
        return null;
    }

    return {
        totalCost,
        inputTokens,
        outputTokens,
        cacheReadTokens: toTokenCount(pickValue(request.usage, CACHE_READ_TOKEN_PATHS) ?? pickValue(request.cache, CACHE_READ_TOKEN_PATHS)),
        cacheWriteTokens: toTokenCount(pickValue(request.usage, CACHE_WRITE_TOKEN_PATHS) ?? pickValue(request.cache, CACHE_WRITE_TOKEN_PATHS)),
        cacheCost: toCost(pickValue(request.pricing, CACHE_COST_PATHS)),
    };
}

function accumulateBilling(metadata) {
    if (!isPlainObject(metadata) || !Array.isArray(metadata.requests)) {
        return null;
    }

    if (metadata.incomplete === true) {
        return null;
    }

    const requests = metadata.requests.map(sanitizeBillingRequest).filter(Boolean);
    if (!requests.length) {
        return null;
    }

    const summary = {
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheCost: 0,
        hasCacheCost: false,
        canShowCacheCost: true,
    };

    for (const request of requests) {
        const metrics = getRequestMetrics(request);
        if (!metrics) {
            continue;
        }

        summary.totalCost += metrics.totalCost;
        summary.inputTokens += metrics.inputTokens;
        summary.outputTokens += metrics.outputTokens;

        const cacheReadTokens = metrics.cacheReadTokens ?? 0;
        const cacheWriteTokens = metrics.cacheWriteTokens ?? 0;
        summary.cacheReadTokens += cacheReadTokens;
        summary.cacheWriteTokens += cacheWriteTokens;

        if (metrics.cacheCost !== null) {
            summary.cacheCost += metrics.cacheCost;
            summary.hasCacheCost = true;
        } else if (cacheReadTokens > 0 || cacheWriteTokens > 0) {
            summary.canShowCacheCost = false;
        }
    }

    if (!summary.canShowCacheCost || !summary.hasCacheCost) {
        summary.cacheCost = null;
    }

    return summary;
}

export function formatBillingDisplay(metadata) {
    const summary = accumulateBilling(metadata);
    if (!summary) {
        return null;
    }

    const hasCacheTokens = summary.cacheReadTokens > 0 || summary.cacheWriteTokens > 0;
    const hasCacheCost = summary.cacheCost !== null && (summary.cacheCost > 0 || hasCacheTokens);
    const title = [`in/out: ${summary.inputTokens}t/${summary.outputTokens}t`];

    if (hasCacheTokens) {
        title.push(`cache: ${summary.cacheReadTokens}t/${summary.cacheWriteTokens}t`);
    }

    return {
        totalCost: formatUsd(summary.totalCost),
        cacheCost: hasCacheCost ? formatUsd(summary.cacheCost) : null,
        title: title.join(' '),
    };
}
