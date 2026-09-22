import { describe, expect, it } from 'vitest'
import { modelFamily } from './model-families'

describe('model families', () => {
  it.each([
    ['claude-sonnet-4.5', 'Sonnet 4.5', 'Claude'],
    ['anthropic/claude-opus-4.6', 'Opus', 'Claude'],
    ['gpt-4.1', 'GPT-4.1', 'GPT'],
    ['openai/gpt-5-mini', 'Small model', 'GPT'],
    ['azure:gpt-4o', 'Fast model', 'GPT'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro', 'Gemini'],
    ['google/gemini-3-flash', 'Gemini Flash', 'Gemini'],
    ['o3-mini', 'Reasoning', 'OpenAI o-series'],
    ['openai/o4-mini', 'Reasoning', 'OpenAI o-series'],
    ['grok-code-fast-1', 'Grok Code Fast', 'Grok'],
    ['raptor-mini', 'Raptor mini', 'Raptor'],
    ['opaque-id', 'Claude Haiku 4.5', 'Claude'],
    ['GPT-5.4', 'Alias', 'GPT'],
    ['unfamiliar-model', 'Future model', 'Other models'],
    ['not-gpt', 'MyGPT helper', 'Other models'],
    ['o365-helper', 'Office helper', 'Other models']
  ])('groups %s without depending on account access', (id, name, family) => {
    expect(modelFamily({ id, name })).toBe(family)
  })
})
