# Set up AI Review

AI Review finds semantic problems the Check cannot see, such as alt text that does not describe the image. It runs only when you start it with **Allyproof: Start AI Review**, and Allyproof tells you which provider will see your code before the first review.

Choose the provider with `allyproof.aiReview.provider`:

- **GitHub Copilot** (default): uses your Copilot models. To use your own API key (OpenAI, Anthropic, Gemini and others), add the model to Copilot with **Chat: Manage Language Models**; AI Review can then use it too.
- **Local model**: any OpenAI-compatible server on your machine, such as LM Studio (`http://localhost:1234/v1`) or Ollama (`http://localhost:11434/v1`). Set `allyproof.aiReview.localEndpoint` and, optionally, `allyproof.aiReview.localModel`. Your code stays on your machine.

In an untrusted workspace AI Review uses only Copilot, so a repository cannot redirect your code to another endpoint.
