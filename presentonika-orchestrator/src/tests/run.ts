import { runImagePlanTests } from "./imagePlan.test";
import { runPlaceholderTests } from "./placeholders.test";
import { runLlmParsingTests } from "./llmParsing.test";
import { runLlmBatchingTests } from "./llmBatching.test";
import { runQualityGateTests } from "./qualityGate.test";
import { runTemplateGeneratorTests } from "./templateGenerator.test";
import { runTemplateGenerateArgTests } from "./templateGenerateArgs.test";

runPlaceholderTests();
runImagePlanTests();
runLlmParsingTests();
runLlmBatchingTests();
runQualityGateTests();
runTemplateGeneratorTests();
runTemplateGenerateArgTests();
console.log("tests: ok");
