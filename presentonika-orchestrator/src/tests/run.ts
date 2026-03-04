import { runImagePlanTests } from "./imagePlan.test";
import { runPlaceholderTests } from "./placeholders.test";
import { runLlmParsingTests } from "./llmParsing.test";
import { runLlmBatchingTests } from "./llmBatching.test";
import { runQualityGateTests } from "./qualityGate.test";

runPlaceholderTests();
runImagePlanTests();
runLlmParsingTests();
runLlmBatchingTests();
runQualityGateTests();
console.log("tests: ok");
