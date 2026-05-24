# SillyTavern NanoGPT Billing

Displays exact NanoGPT per-message billing metadata when SillyTavern exposes the `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

## Current Status

This extension depends on currently unmerged SillyTavern core changes. It will not work with upstream SillyTavern until the core metadata hook lands.

For now, test it against Gregory Bartell's SillyTavern fork on the `poc/nanogpt-response-metadata` branch:

```text
https://github.com/gregbartell/SillyTavern/tree/poc/nanogpt-response-metadata
```

That branch is built on top of SillyTavern PR #5542 plus a follow-up `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

This extension only shows billing returned by NanoGPT in `x_nanogpt_pricing`. It does not estimate costs from model pricing tables. Billing metadata is stored in `message.extra.extensions.nanogptBilling` and in the active swipe extra for swipe-specific display.

## Requirements

- SillyTavern with `CHAT_COMPLETION_RESPONSE_METADATA` support, currently from `gregbartell/SillyTavern:poc/nanogpt-response-metadata`.
- NanoGPT Chat Completion responses that include `x_nanogpt_pricing`.

## Development

```bash
npm test
```
