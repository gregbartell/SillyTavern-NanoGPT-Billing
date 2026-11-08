import {
    createBillingEntryFromMetadata,
    formatBillingDisplay,
    mergeBillingMetadata,
} from './billing.js';

const SETTINGS_KEY = 'chatCompletionBilling';
const LEGACY_SETTINGS_KEY = 'nanogptBilling';
const EVENT_NAME = 'CHAT_COMPLETION_RESPONSE_METADATA';
const APPEND_TYPES = new Set(['append', 'continue', 'appendFinal']);
const DISPLAY_SELECTOR = '.chat-completion-billing-display, .nanogpt-billing-display';

let initialized = false;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getSettings() {
    const context = getContext();
    const legacySettings = context.extensionSettings[LEGACY_SETTINGS_KEY];
    context.extensionSettings[SETTINGS_KEY] ??= {
        enabled: legacySettings?.enabled ?? true,
    };
    context.extensionSettings[SETTINGS_KEY].enabled ??= true;
    return context.extensionSettings[SETTINGS_KEY];
}

function isMetadataHookAvailable(context) {
    return Boolean(context?.eventTypes?.[EVENT_NAME]);
}

async function renderSettings() {
    const context = getContext();
    if (!context) {
        return;
    }

    const settings = getSettings();
    const container = document.querySelector('#extensions_settings2');
    if (!container) {
        return;
    }

    document.querySelector('#chat-completion-billing-settings')?.remove();
    document.querySelector('#nanogpt-billing-settings')?.remove();

    const response = await fetch(new URL('./settings.html', import.meta.url));
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    container.append(template.content.cloneNode(true));

    const checkbox = document.querySelector('#chat_completion_billing_enabled');
    const warning = document.querySelector('#chat_completion_billing_warning');

    checkbox.checked = !!settings.enabled;
    warning.hidden = isMetadataHookAvailable(context);

    checkbox.addEventListener('change', () => {
        settings.enabled = checkbox.checked;
        context.saveSettingsDebounced();
        renderVisibleMessages();
    });
}

function getMessageBillingMetadata(message) {
    if (!message) {
        return null;
    }

    const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : null;
    const swipeMetadata = swipeId !== null
        ? getStoredBillingMetadata(message.swipe_info?.[swipeId]?.extra)
        : null;

    return swipeMetadata ?? getStoredBillingMetadata(message.extra);
}

function getStoredBillingMetadata(extra) {
    return extra?.extensions?.[SETTINGS_KEY]
        ?? extra?.extensions?.[LEGACY_SETTINGS_KEY]
        ?? null;
}

function ensureExtensionExtra(extra) {
    extra.extensions ??= {};
    return extra.extensions;
}

function cloneMetadata(metadata) {
    return typeof structuredClone === 'function'
        ? structuredClone(metadata)
        : JSON.parse(JSON.stringify(metadata));
}

function shouldAppendBilling(payload) {
    return APPEND_TYPES.has(payload?.originalType) || APPEND_TYPES.has(payload?.type);
}

function persistBillingMetadata(payload, request) {
    const context = getContext();
    const message = context?.chat?.[payload.messageId];
    if (!message) {
        return false;
    }

    message.extra ??= {};
    const swipeId = Number.isInteger(payload.swipeId) ? payload.swipeId : message.swipe_id;
    const isActiveSwipe = swipeId === message.swipe_id;
    const swipeInfo = Number.isInteger(swipeId) ? message.swipe_info?.[swipeId] : null;
    if (!isActiveSwipe && !swipeInfo) return false;
    const existing = getStoredBillingMetadata(swipeInfo?.extra)
        ?? (isActiveSwipe ? getStoredBillingMetadata(message.extra) : null);
    const metadata = mergeBillingMetadata(existing, request, { append: shouldAppendBilling(payload) });

    if (!metadata) {
        return false;
    }

    if (isActiveSwipe) ensureExtensionExtra(message.extra)[SETTINGS_KEY] = cloneMetadata(metadata);

    if (swipeInfo) {
        swipeInfo.extra ??= {};
        ensureExtensionExtra(swipeInfo.extra)[SETTINGS_KEY] = cloneMetadata(metadata);
    }

    return true;
}

function getMessageElement(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
}

function removeMessageDisplay(messageId) {
    getMessageElement(messageId)?.querySelectorAll(DISPLAY_SELECTOR).forEach(node => node.remove());
}

function ensureMessageDisplay(messageId) {
    const messageElement = getMessageElement(messageId);
    const wrapper = messageElement?.querySelector('.mesAvatarWrapper');
    if (!wrapper) {
        return null;
    }

    let display = wrapper.querySelector('.chat-completion-billing-display');
    if (!display) {
        display = document.createElement('div');
        display.className = 'chat-completion-billing-display';
        display.innerHTML = '<div class="chat-completion-billing-line chat-completion-billing-total"></div>';
        wrapper.append(display);
    }

    return display;
}

function renderMessageBilling(messageId) {
    const context = getContext();
    const settings = getSettings();
    const message = context?.chat?.[messageId];

    if (!settings.enabled || !message) {
        removeMessageDisplay(messageId);
        return;
    }

    const metadata = getMessageBillingMetadata(message);
    const formatted = formatBillingDisplay(metadata);
    if (!formatted && !metadata?.incomplete) {
        removeMessageDisplay(messageId);
        return;
    }

    const display = ensureMessageDisplay(messageId);
    const totalLine = display?.querySelector('.chat-completion-billing-total');
    if (!totalLine) {
        return;
    }

    totalLine.textContent = formatted
        ? `cost: ${formatted.totalCost}${formatted.cacheCost ? ` cache: ${formatted.cacheCost}` : ''}`
        : 'cost: unavailable';
    totalLine.title = formatted?.title ?? 'A complete provider-reported cost is unavailable for this message.';
}

function renderVisibleMessages() {
    const context = getContext();
    if (!context) {
        return;
    }

    if (!getSettings().enabled) {
        document.querySelectorAll(DISPLAY_SELECTOR).forEach(node => node.remove());
        return;
    }

    document.querySelectorAll('#chat .mes[mesid]').forEach(element => {
        const messageId = Number(element.getAttribute('mesid'));
        if (Number.isInteger(messageId)) {
            renderMessageBilling(messageId);
        }
    });
}

function queueRenderVisibleMessages() {
    setTimeout(renderVisibleMessages, 0);
}

async function onChatCompletionResponseMetadata(payload) {
    const context = getContext();
    const settings = getSettings();

    if (!settings.enabled) {
        return;
    }

    const request = createBillingEntryFromMetadata(payload);
    if (!request && payload?.chatCompletionSource !== 'openrouter'
        && !getMessageBillingMetadata(context.chat[payload?.messageId])) return;
    if (!persistBillingMetadata(payload, request)) {
        return;
    }

    renderMessageBilling(payload.messageId);
    await context.saveChat();
}

export async function init() {
    if (initialized) {
        return;
    }
    initialized = true;

    const context = getContext();
    if (!context) {
        console.warn('Chat Completion Billing: SillyTavern context is unavailable.');
        return;
    }

    await renderSettings();

    if (isMetadataHookAvailable(context)) {
        context.eventSource.on(context.eventTypes[EVENT_NAME], onChatCompletionResponseMetadata);
    }

    context.eventSource.on(context.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId => renderMessageBilling(messageId));
    context.eventSource.on(context.eventTypes.MESSAGE_SWIPED, messageId => renderMessageBilling(messageId));
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        document.querySelectorAll(DISPLAY_SELECTOR).forEach(node => node.remove());
        queueRenderVisibleMessages();
    });
    context.eventSource.on(context.eventTypes.MORE_MESSAGES_LOADED, queueRenderVisibleMessages);

    queueRenderVisibleMessages();
}
