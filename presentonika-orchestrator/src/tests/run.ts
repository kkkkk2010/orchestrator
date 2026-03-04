import { runImagePlanTests } from "./imagePlan.test";
import { runPlaceholderTests } from "./placeholders.test";
import { runLlmParsingTests } from "./llmParsing.test";
import { runLlmBatchingTests } from "./llmBatching.test";

runPlaceholderTests();
runImagePlanTests();
runLlmParsingTests();
runLlmBatchingTests();
console.log("tests: ok");
