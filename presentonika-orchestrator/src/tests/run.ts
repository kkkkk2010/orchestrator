import { runImagePlanTests } from "./imagePlan.test";
import { runPlaceholderTests } from "./placeholders.test";
import { runLlmParsingTests } from "./llmParsing.test";

runPlaceholderTests();
runImagePlanTests();
runLlmParsingTests();
console.log("tests: ok");
