import type { AiProviderDefinition } from "./types.js";

export const AI_PROVIDER_DEFINITIONS: AiProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Use OpenAI models for future marker generation and analysis features.",
    supportsCustomBaseUrl: false,
    capabilities: ["marker-generation", "chord-analysis"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Use Claude models through Anthropic's API.",
    supportsCustomBaseUrl: false,
    capabilities: ["marker-generation", "chord-analysis"],
  },
  {
    id: "openai-compatible",
    label: "OpenAI-Compatible",
    description: "Connect any provider that exposes an OpenAI-compatible API endpoint.",
    supportsCustomBaseUrl: true,
    capabilities: ["marker-generation", "chord-analysis"],
  },
];

export function getAiProviderDefinition(id: string): AiProviderDefinition | undefined {
  return AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === id);
}
