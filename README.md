# SillyTavern Chat Completion Billing

Displays exact provider-reported per-message costs when SillyTavern exposes the `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

## Current Status

This extension depends on currently unmerged SillyTavern core changes. It will not work with upstream SillyTavern until the core metadata hook lands.

For now, test it against Gregory Bartell's SillyTavern fork on the `poc/nanogpt-response-metadata` branch:

```text
https://github.com/gregbartell/SillyTavern/tree/poc/nanogpt-response-metadata
```

That branch is built on top of SillyTavern PR #5542 plus a follow-up `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

Supported providers:

- NanoGPT, using `x_nanogpt_pricing` and `x_nanogpt_cache`.
- OpenRouter, using `usage.cost`, token details, and optional `openrouter_metadata` for provider attribution.

The extension does not estimate costs from model pricing tables. It only displays costs reported by the provider. New billing metadata is stored in `message.extra.extensions.chatCompletionBilling` and in the active swipe extra for swipe-specific display. Existing `nanogptBilling` message metadata and settings remain readable.

## Requirements

- SillyTavern with `CHAT_COMPLETION_RESPONSE_METADATA` support, currently from `gregbartell/SillyTavern:poc/nanogpt-response-metadata`.
- NanoGPT responses that include `x_nanogpt_pricing`, or OpenRouter responses that include `usage.cost`.

## Development

```bash
npm test
```
