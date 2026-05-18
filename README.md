# SillyTavern NanoGPT Billing

Displays exact NanoGPT per-message billing metadata when SillyTavern exposes the `CHAT_COMPLETION_RESPONSE_METADATA` extension event.

This extension only shows billing returned by NanoGPT in `x_nanogpt_pricing`. It does not estimate costs from model pricing tables. Billing metadata is stored in `message.extra.extensions.nanogptBilling` and in the active swipe extra for swipe-specific display.

## Requirements

- SillyTavern with `CHAT_COMPLETION_RESPONSE_METADATA` support.
- NanoGPT Chat Completion responses that include `x_nanogpt_pricing`.

## Development

```bash
npm test
```
