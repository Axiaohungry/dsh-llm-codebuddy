import assert from "node:assert/strict";
import test from "node:test";
import { __testing } from "./index.js";

test("模型目录保留逐模型思考能力和默认档位", () => {
  const models = __testing.modelsFromConfig({
    agents: [{ name: "cli", models: ["reasoning", "plain"] }],
    models: [
      { id: "reasoning", name: "Reasoning", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: true, onlyReasoning: true, reasoning: { effort: "high" } },
      { id: "plain", name: "Plain", maxInputTokens: 1000, maxOutputTokens: 100, supportsReasoning: false },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), ["reasoning", "plain"]);
  assert.equal(models[0].reasoning, true);
  assert.equal(models[0].thinkingLevelMap.off, null);
  assert.equal(models[0].thinkingLevelMap.xhigh, undefined);
  assert.equal(models[0].defaultReasoningEffort, "high");
  assert.equal(models[1].reasoning, false);
});

test("自定义模型可覆盖自己的思考档位", () => {
  const [model] = __testing.selectCodeBuddyModels([], [{
    id: "custom",
    contextWindow: 1000,
    maxTokens: 100,
    reasoningEfforts: { off: null, medium: "balanced" },
  }]);

  assert.equal(model.reasoning, true);
  assert.equal(Object.hasOwn(model.thinkingLevelMap, "off"), false);
  assert.equal(model.thinkingLevelMap.medium, "balanced");
  assert.equal(model.thinkingLevelMap.high, null);
});
