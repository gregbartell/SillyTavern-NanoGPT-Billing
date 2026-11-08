# SillyTavern Chat Completion Billing

Displays exact provider-reported per-message costs when SillyTavern exposes the `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

## Current Status

This extension depends on currently unmerged SillyTavern core changes. It will not work with upstream SillyTavern until the core metadata hook lands.

The [`feat/openrouter-message-cost` branch](https://github.com/gregbartell/SillyTavern/tree/feat/openrouter-message-cost)
in Gregory Bartell's SillyTavern fork provides a minimal OpenRouter billing hook
based on upstream staging.
Other saved responses signal absent billing data so an unpriced continuation
cannot retain an old complete total.
Use this extension (version 0.2.1 or later) with that core branch.

The older [`poc/nanogpt-response-metadata` branch](https://github.com/gregbartell/SillyTavern/tree/poc/nanogpt-response-metadata)
remains compatible and also provides NanoGPT metadata.

Supported providers:

- NanoGPT, using `x_nanogpt_pricing` and `x_nanogpt_cache`.
- OpenRouter, using `usage.cost`, token details, and optional `openrouter_metadata` for provider attribution.

The extension does not estimate costs from model pricing tables. It only displays costs reported by the provider. New billing metadata is stored in `message.extra.extensions.chatCompletionBilling` and in the active swipe extra for swipe-specific display. Existing `nanogptBilling` message metadata and settings remain readable.

OpenRouter costs come from `usage.cost`; routing metadata is optional. Free
responses display `$0.000000`. Continuations add to the selected swipe's cost.
If a response has no usable billing data, or the original message cost is unknown,
the total displays `cost: unavailable` and remains incomplete across reloads and
later continuations. A newly generated swipe starts its own total. This is a cost
for the saved message/swipe, not an account-wide total including discarded tool
calls, background requests, or other swipes.

## Requirements

- SillyTavern with `CHAT_COMPLETION_RESPONSE_METADATA` support, as described above.
- NanoGPT responses that include `x_nanogpt_pricing`, or OpenRouter responses that include `usage.cost`.

## Installation and updates

In SillyTavern, open **Extensions → Install extension** and use:

```text
https://github.com/gregbartell/SillyTavern-NanoGPT-Billing
```

The default `main` branch includes OpenRouter support. If already installed,
update the extension and reload SillyTavern. The extension appears as
**Chat Completion Billing**, despite the repository's historical NanoGPT name.
The compatible SillyTavern core branch described above is still required.

## Development

```bash
npm test
```
